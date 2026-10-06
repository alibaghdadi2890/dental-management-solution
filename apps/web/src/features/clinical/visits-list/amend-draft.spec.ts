import type { VisitListItem } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { amendInput, draftOf, draftTotal, isDirty, problemOf } from './amend-draft';

const usd = (amount: string) => ({ amount, currency: 'USD' });

const VISIT = {
  updatedAt: '2026-09-04T09:30:00.000Z',
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

describe('amend draft', () => {
  it('starts clean, as the visit is', () => {
    const draft = draftOf(VISIT);
    expect(isDirty(draft, VISIT)).toBe(false);
    expect(draftTotal(draft, VISIT)).toBe('135.00');
    expect(problemOf(draft)).toBeNull();
  });

  it('is dirty once a service is removed, re-toothed or the discount changes', () => {
    const removed = draftOf(VISIT);
    removed.lines[1] = { ...removed.lines[1]!, removed: true };
    expect(isDirty(removed, VISIT)).toBe(true);
    expect(draftTotal(removed, VISIT)).toBe('90.00');

    const moved = draftOf(VISIT);
    moved.lines[0] = { ...moved.lines[0]!, toothCode: '37' };
    expect(isDirty(moved, VISIT)).toBe(true);

    const reordered = draftOf(VISIT);
    reordered.lines[0] = { ...reordered.lines[0]!, surfaces: ['O', 'M'] };
    expect(isDirty(reordered, VISIT)).toBe(false);

    const discount = draftOf(VISIT);
    discount.discount = { mode: 'percent', value: '10' };
    expect(isDirty(discount, VISIT)).toBe(false);
    discount.discount = { mode: 'amount', value: '10' };
    expect(isDirty(discount, VISIT)).toBe(true);
    expect(draftTotal(discount, VISIT)).toBe('140.00');
  });

  it('names what blocks saving', () => {
    const none = draftOf(VISIT);
    none.lines = none.lines.map((line) => ({ ...line, removed: true }));
    expect(problemOf(none)).toBe('noService');

    const anterior = draftOf(VISIT);
    anterior.lines[0] = { ...anterior.lines[0]!, toothCode: '11' };
    expect(problemOf(anterior)).toBe('tooth');

    const discount = draftOf(VISIT);
    discount.discount = { mode: 'amount', value: '1,5' };
    expect(problemOf(discount)).toBe('discount');
  });

  it('sends the services that stay, with tooth and surfaces for per-tooth ones', () => {
    const draft = draftOf(VISIT);
    draft.lines[0] = { ...draft.lines[0]!, toothCode: '37' };
    draft.lines[1] = { ...draft.lines[1]!, removed: true };
    draft.discount = { mode: 'percent', value: '' };
    expect(amendInput(draft, VISIT, 'Tooth corrected')).toEqual({
      expectedUpdatedAt: VISIT.updatedAt,
      reason: 'Tooth corrected',
      discount: { mode: 'percent', value: '0' },
      services: [{ id: 'filling', toothCode: '37', surfaces: ['M', 'O'] }],
    });
  });
});
