import { describe, expect, it } from 'vitest';
import { planAmendment, type AmendableService, type AmendableVisit } from './visit-amendment';
import {
  AmendNoChangeError,
  AmendPlanLinkedError,
  AmendUnknownServiceError,
  SurfacesInvalidError,
  ToothNotAllowedError,
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
  discountMode: 'percent',
  discountValue: '0',
  services: [filling, cleaning, crown],
  ...overrides,
});

const keepAll = [{ id: filling.id }, { id: cleaning.id }, { id: crown.id }];
const noDiscount = { mode: 'percent' as const, value: '0' };

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
    expect(() =>
      planAmendment(visit(), {
        discount: noDiscount,
        services: [{ id: filling.id, surfaces: ['O', 'M'] }, { id: cleaning.id }, { id: crown.id }],
      }),
    ).toThrow(AmendNoChangeError);
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

  it('refuses an amendment that changes nothing', () => {
    expect(() => planAmendment(visit(), { discount: noDiscount, services: keepAll })).toThrow(
      AmendNoChangeError,
    );
    expect(() =>
      planAmendment(visit(), { discount: { mode: 'percent', value: '0.00' }, services: keepAll }),
    ).toThrow(AmendNoChangeError);
  });
});
