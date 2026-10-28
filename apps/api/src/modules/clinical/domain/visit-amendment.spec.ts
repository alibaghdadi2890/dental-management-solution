import { describe, expect, it } from 'vitest';
import { CatalogItemInactiveError } from './catalog-errors';
import {
  planAmendment,
  type AddableService,
  type AmendableService,
  type AmendableVisit,
  type AmendmentContext,
} from './visit-amendment';
import {
  AmendPlanLinkedError,
  CurrencyMismatchError,
  AmendUnknownServiceError,
  SurfacesInvalidError,
  ToothNotAllowedError,
  ToothRequiredError,
} from './visit-errors';

const filling: AmendableService = {
  id: 'svc-filling',
  code: 'FIL',
  name: 'Filling',
  chargeUnit: 'per_tooth',
  toothCode: '36',
  jaw: null,
  surfaces: ['M', 'O'],
  baseAmount: '100.00',
  discountAmount: '0.00',
  planId: null,
};
const cleaning: AmendableService = {
  id: 'svc-cleaning',
  code: 'CLN',
  name: 'Cleaning',
  chargeUnit: 'per_mouth',
  toothCode: null,
  jaw: null,
  surfaces: [],
  baseAmount: '60.00',
  discountAmount: '10.00',
  planId: null,
};
const crown: AmendableService = {
  id: 'svc-crown',
  code: 'CRN',
  name: 'Crown',
  chargeUnit: 'per_tooth',
  toothCode: '11',
  jaw: null,
  surfaces: [],
  baseAmount: '300.00',
  discountAmount: '0.00',
  planId: 'plan-crown',
};

const visit = (overrides: Partial<AmendableVisit> = {}): AmendableVisit => ({
  currency: 'USD',
  discountMode: 'percent',
  discountValue: '0',
  services: [filling, cleaning, crown],
  ...overrides,
});

const keepAll = [{ id: filling.id }, { id: cleaning.id }, { id: crown.id }];
const noDiscount = { mode: 'percent' as const, value: '0' };

const implant: AddableService = {
  id: 'proc-implant',
  code: 'IMP',
  name: 'Implant',
  category: 'surgery',
  chargeUnit: 'per_tooth',
  price: { amount: '70.00', currency: 'USD' },
  active: true,
};
const catalog = (...items: AddableService[]): AmendmentContext => {
  let next = 0;
  return {
    catalog: new Map(items.map((item) => [item.id, item])),
    newId: () => `new-${String((next += 1))}`,
  };
};

describe('planAmendment', () => {
  it('removes a service: the total drops by its final price and the delta is negative', () => {
    const plan = planAmendment(visit(), {
      discount: noDiscount,
      services: [{ id: filling.id }, { id: crown.id }],
    });
    expect(plan.removed.map((service) => service.id)).toEqual([cleaning.id]);
    expect(plan.before.total).toBe('450.00');
    expect(plan.after.total).toBe('400.00');
    expect(plan.delta).toBe('-50.00');
    expect(plan.plansToReopen).toEqual([]);
    expect(plan.after.services.map((service) => service.id)).toEqual([filling.id, crown.id]);
  });

  it('says whether pricing changes — the discount or a typed price: that needs visit:discount (ADR-0055)', () => {
    const removal = planAmendment(visit(), {
      discount: { mode: 'percent', value: '0.00' },
      services: [{ id: filling.id }, { id: crown.id }],
    });
    expect(removal.pricingChanged).toBe(false);
    const discounted = planAmendment(visit(), {
      discount: { mode: 'percent', value: '10' },
      services: keepAll,
    });
    expect(discounted.pricingChanged).toBe(true);
  });

  it("sets a kept line's price: base = price, line discount 0", () => {
    const plan = planAmendment(visit(), {
      discount: noDiscount,
      services: [
        { id: filling.id, price: '120' },
        { id: cleaning.id, price: '60' },
        { id: crown.id },
      ],
    });
    expect(plan.priced).toEqual([
      { id: filling.id, baseAmount: '120.00' },
      { id: cleaning.id, baseAmount: '60.00' },
    ]);
    expect(plan.after.total).toBe('480.00');
    expect(plan.delta).toBe('30.00');
    expect(plan.pricingChanged).toBe(true);
    const same = planAmendment(visit(), {
      discount: noDiscount,
      services: [{ id: filling.id, price: '100.00' }, { id: cleaning.id }, { id: crown.id }],
    });
    expect(same.changed).toBe(false);
  });

  it('replaces a service: the new one at its catalog price, unless a price is typed', () => {
    const plan = planAmendment(
      visit({ services: [cleaning] }),
      {
        discount: noDiscount,
        services: [{ procedureId: implant.id, toothCode: '46', surfaces: [] }],
      },
      catalog(implant),
    );
    expect(plan.removed.map((service) => service.id)).toEqual([cleaning.id]);
    expect(plan.added).toEqual([
      expect.objectContaining({
        id: 'new-1',
        procedureId: implant.id,
        code: 'IMP',
        toothCode: '46',
        jaw: null,
        baseAmount: '70.00',
      }),
    ]);
    expect(plan.after.services.map((service) => service.id)).toEqual(['new-1']);
    expect(plan.delta).toBe('20.00');
    expect(plan.pricingChanged).toBe(false);

    const typed = planAmendment(
      visit({ services: [cleaning] }),
      {
        discount: noDiscount,
        services: [{ procedureId: implant.id, toothCode: '46', surfaces: [], price: '65' }],
      },
      catalog(implant),
    );
    expect(typed.added[0]?.baseAmount).toBe('65.00');
    expect(typed.delta).toBe('15.00');
    expect(typed.pricingChanged).toBe(true);
  });

  it("adds only an active catalog service in the visit's currency, where it may be recorded", () => {
    const add = (item: AddableService, entry: { toothCode?: '46'; jaw?: 'upper' } = {}) =>
      planAmendment(
        visit(),
        {
          discount: noDiscount,
          services: [...keepAll, { procedureId: item.id, surfaces: [], ...entry }],
        },
        catalog(item),
      );
    expect(() => add({ ...implant, active: false }, { toothCode: '46' })).toThrow(
      CatalogItemInactiveError,
    );
    expect(() =>
      add({ ...implant, price: { amount: '70.00', currency: 'EUR' } }, { toothCode: '46' }),
    ).toThrow(CurrencyMismatchError);
    expect(() => add(implant)).toThrow(ToothRequiredError);
    expect(() => add(implant, { toothCode: '46', jaw: 'upper' })).toThrow();
    expect(() =>
      planAmendment(visit(), {
        discount: noDiscount,
        services: [...keepAll, { procedureId: 'proc-unknown', surfaces: [] }],
      }),
    ).toThrow(AmendUnknownServiceError);
  });

  it('reopens the plan a removed service performed (D2)', () => {
    const plan = planAmendment(visit(), {
      discount: noDiscount,
      services: [{ id: filling.id }, { id: cleaning.id }],
    });
    expect(plan.plansToReopen).toEqual(['plan-crown']);
  });

  it('moves a per-tooth service to another tooth with no money change', () => {
    const plan = planAmendment(visit(), {
      discount: noDiscount,
      services: [{ id: filling.id, toothCode: '37' }, { id: cleaning.id }, { id: crown.id }],
    });
    expect(plan.edited).toEqual([{ id: filling.id, toothCode: '37', surfaces: ['M', 'O'] }]);
    expect(plan.delta).toBe('0.00');
    expect(plan.after.services[0]?.toothCode).toBe('37');
  });

  it('treats the same surfaces in another order as unchanged', () => {
    const plan = planAmendment(visit(), {
      discount: noDiscount,
      services: [{ id: filling.id, surfaces: ['O', 'M'] }, { id: cleaning.id }, { id: crown.id }],
    });
    expect(plan.changed).toBe(false);
  });

  it('recomputes with a changed discount, percent and amount', () => {
    const percent = planAmendment(visit(), {
      discount: { mode: 'percent', value: '10' },
      services: keepAll,
    });
    expect(percent.after).toMatchObject({
      subtotal: '450.00',
      discountAmount: '45.00',
      total: '405.00',
    });
    expect(percent.delta).toBe('-45.00');

    const fromDiscounted = planAmendment(visit({ discountMode: 'amount', discountValue: '50' }), {
      discount: noDiscount,
      services: keepAll,
    });
    expect(fromDiscounted.before.total).toBe('400.00');
    expect(fromDiscounted.delta).toBe('50.00');
  });

  it('caps an amount discount at the new subtotal, as while live', () => {
    const plan = planAmendment(visit({ discountMode: 'amount', discountValue: '200' }), {
      discount: { mode: 'amount', value: '200' },
      services: [{ id: cleaning.id }],
    });
    expect(plan.after).toMatchObject({ subtotal: '50.00', discountAmount: '50.00', total: '0.00' });
  });

  it('refuses an unknown or repeated service', () => {
    expect(() =>
      planAmendment(visit(), { discount: noDiscount, services: [{ id: 'svc-other' }] }),
    ).toThrow(AmendUnknownServiceError);
    expect(() =>
      planAmendment(visit(), {
        discount: noDiscount,
        services: [{ id: filling.id }, { id: filling.id }],
      }),
    ).toThrow(AmendUnknownServiceError);
  });

  it('refuses to re-tooth or re-surface a plan-linked service (D2)', () => {
    expect(() =>
      planAmendment(visit(), {
        discount: noDiscount,
        services: [{ id: filling.id }, { id: cleaning.id }, { id: crown.id, toothCode: '21' }],
      }),
    ).toThrow(AmendPlanLinkedError);
  });

  it('applies the recording rules to the new target', () => {
    expect(() =>
      planAmendment(visit(), {
        discount: noDiscount,
        services: [{ id: filling.id }, { id: cleaning.id, toothCode: '36' }, { id: crown.id }],
      }),
    ).toThrow(ToothNotAllowedError);
    expect(() =>
      planAmendment(visit(), {
        discount: noDiscount,
        services: [{ id: filling.id, toothCode: '11' }, { id: cleaning.id }, { id: crown.id }],
      }),
    ).toThrow(SurfacesInvalidError);
  });

  it('says when nothing about the services or the money changes', () => {
    expect(planAmendment(visit(), { discount: noDiscount, services: keepAll }).changed).toBe(false);
    expect(
      planAmendment(visit(), { discount: { mode: 'percent', value: '0.00' }, services: keepAll })
        .changed,
    ).toBe(false);
  });
});
