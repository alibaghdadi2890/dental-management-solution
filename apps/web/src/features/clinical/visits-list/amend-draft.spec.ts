import type { ServiceItem, VisitListItem } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AmendDraft,
  type AmendLine,
  amendInput,
  draftOf,
  draftTotal,
  isDirty,
  isServicesDirty,
  type KeptLine,
  problemOf,
  withService,
} from './amend-draft';

const usd = (amount: string) => ({ amount, currency: 'USD' });

/** Beirut is UTC+3 in September: the visit ran 10:00–12:30 on 2026-09-04. */
const ZONE = 'Asia/Beirut';
const NOW = new Date('2026-09-05T09:00:00Z');

const VISIT = {
  updatedAt: '2026-09-04T09:30:00.000Z',
  localDate: '2026-09-04',
  startedAt: '2026-09-04T07:00:00.000Z',
  completedAt: '2026-09-04T09:30:00.000Z',
  discount: { mode: 'percent', value: '10.00' },
  services: [
    {
      id: 'filling',
      code: 'FIL',
      name: 'Filling',
      chargeUnit: 'per_tooth',
      toothCode: '36',
      jaw: null,
      surfaces: ['M', 'O'],
      planId: null,
      final: usd('100.00'),
    },
    {
      id: 'cleaning',
      code: 'CLN',
      name: 'Cleaning',
      chargeUnit: 'per_mouth',
      toothCode: null,
      jaw: null,
      surfaces: [],
      planId: null,
      final: usd('50.00'),
    },
  ],
} as unknown as VisitListItem;

const implant = {
  id: 'proc-implant',
  name: 'Implant',
  chargeUnit: 'per_tooth',
  price: usd('70.00'),
} as ServiceItem;
const denture = {
  id: 'proc-denture',
  name: 'Denture',
  chargeUnit: 'per_jaw',
  price: usd('400.00'),
} as ServiceItem;

const draft = () => draftOf(VISIT, ZONE);

/** The draft with line `index` changed. */
function edit(base: AmendDraft, index: number, change: Partial<KeptLine>): AmendDraft {
  const lines = [...base.lines];
  lines[index] = { ...(lines[index] as KeptLine), ...change };
  return { ...base, lines };
}

const placed = (base: AmendDraft, change: Partial<AmendLine>): AmendDraft => {
  const lines = [...base.lines];
  const last = lines.pop();
  return { ...base, lines: [...lines, { ...last, ...change } as AmendLine] };
};

describe('correction draft', () => {
  it('starts clean, as the visit is, on its own times', () => {
    const clean = draft();
    expect(clean.times).toEqual({ start: '10:00', end: '12:30' });
    expect(isDirty(clean, VISIT, ZONE)).toBe(false);
    expect(draftTotal(clean)).toBe('135.00');
    expect(problemOf(clean, VISIT, ZONE, NOW)).toBeNull();
  });

  it('is dirty once a service is removed, re-toothed, repriced, the discount or the times change', () => {
    const removed = edit(draft(), 1, { removed: true });
    expect(isDirty(removed, VISIT, ZONE)).toBe(true);
    expect(draftTotal(removed)).toBe('90.00');

    expect(isDirty(edit(draft(), 0, { toothCode: '37' }), VISIT, ZONE)).toBe(true);
    expect(isDirty(edit(draft(), 0, { surfaces: ['O', 'M'] }), VISIT, ZONE)).toBe(false);
    expect(isDirty(edit(draft(), 0, { price: '100' }), VISIT, ZONE)).toBe(false);
    expect(draftTotal(edit(draft(), 0, { price: '120' }))).toBe('153.00');

    const discount: AmendDraft = { ...draft(), discount: { mode: 'percent', value: '10' } };
    expect(isDirty(discount, VISIT, ZONE)).toBe(false);
    discount.discount = { mode: 'amount', value: '10' };
    expect(isDirty(discount, VISIT, ZONE)).toBe(true);
    expect(draftTotal(discount)).toBe('140.00');

    const times = { ...draft(), times: { start: '10:15', end: '11:00' } };
    expect(isDirty(times, VISIT, ZONE)).toBe(true);
    expect(isServicesDirty(times, VISIT)).toBe(false);
  });

  it('adds a catalog service at its catalog price, to be placed', () => {
    const added = withService(edit(draft(), 1, { removed: true }), implant);
    expect(isServicesDirty(added, VISIT)).toBe(true);
    expect(draftTotal(added)).toBe('153.00');
    expect(problemOf(added, VISIT, ZONE, NOW)).toBe('tooth');
    expect(problemOf(placed(added, { toothCode: '46' }), VISIT, ZONE, NOW)).toBeNull();

    const jaw = withService(draft(), denture);
    expect(problemOf(jaw, VISIT, ZONE, NOW)).toBe('jaw');
    expect(problemOf(placed(jaw, { jaw: 'upper' }), VISIT, ZONE, NOW)).toBeNull();
  });

  it('names what blocks saving', () => {
    const none = { ...draft() };
    none.lines = none.lines.map((line) => ({ ...line, removed: true }));
    expect(problemOf(none, VISIT, ZONE, NOW)).toBe('noService');
    expect(problemOf(edit(draft(), 0, { toothCode: '11' }), VISIT, ZONE, NOW)).toBe('tooth');
    expect(problemOf(edit(draft(), 0, { price: 'ten' }), VISIT, ZONE, NOW)).toBe('price');
    const discount = { ...draft(), discount: { mode: 'amount' as const, value: '1,5' } };
    expect(problemOf(discount, VISIT, ZONE, NOW)).toBe('discount');
    const future = { ...draft(), times: { start: '10:00', end: '12:01' } };
    expect(problemOf(future, VISIT, ZONE, new Date('2026-09-04T09:00:00Z'))).toBe('timesFuture');
    const order = { ...draft(), times: { start: '10:00', end: '10:00' } };
    expect(problemOf(order, VISIT, ZONE, NOW)).toBe('timesOrder');
  });

  it('sends the services that stay and those added, prices only when typed, times when changed', () => {
    let body = edit(draft(), 0, { toothCode: '37', price: '120' });
    body = edit(body, 1, { removed: true });
    body = placed(withService(body, implant), { toothCode: '46' });
    body = { ...body, discount: { mode: 'percent', value: '' } };
    expect(amendInput(body, VISIT, ZONE, 'Wrong service')).toEqual({
      expectedUpdatedAt: VISIT.updatedAt,
      reason: 'Wrong service',
      discount: { mode: 'percent', value: '0' },
      services: [
        { id: 'filling', toothCode: '37', surfaces: ['M', 'O'], price: '120' },
        { procedureId: 'proc-implant', toothCode: '46', surfaces: [] },
      ],
    });

    const times = { ...draft(), times: { start: '10:15', end: '11:00' } };
    expect(amendInput(times, VISIT, ZONE, 'Timer left running')).toMatchObject({
      services: [{ id: 'filling', toothCode: '36', surfaces: ['M', 'O'] }, { id: 'cleaning' }],
      times: { startedAt: '2026-09-04T07:15:00.000Z', completedAt: '2026-09-04T08:00:00.000Z' },
    });
  });
});
