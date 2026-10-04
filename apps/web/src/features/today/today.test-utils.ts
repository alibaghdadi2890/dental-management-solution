import type { VisitBalance, VisitListItem } from '@dcm/contracts';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

/** A completed visit of today as the visits list gives it, number `n`, finished at 09:`n` UTC. */
export function listVisit(
  n: number,
  fullName: string,
  extra: Partial<VisitListItem> = {},
): VisitListItem {
  return {
    id: id(n),
    displayNumber: n,
    status: 'completed',
    localDate: '2026-09-04',
    startedAt: '2026-09-04T09:00:00.000Z',
    completedAt: `2026-09-04T09:${String(n)}:00.000Z`,
    durationMinutes: 45,
    pausedAt: null,
    pausedSeconds: 0,
    branchId: id(2),
    room: { id: id(3), name: 'Room 1' },
    patient: { id: id(n + 40), displayNumber: `P-0000${String(n)}`, fullName },
    dentist: { id: id(5), name: 'Dr. Ana Reyes' },
    services: [
      {
        id: id(6),
        code: 'FIL',
        name: 'Composite filling',
        chargeUnit: 'per_tooth',
        toothCode: '16',
        surfaces: ['O'],
        planId: null,
        final: { amount: '140.00', currency: 'USD' },
      },
    ],
    notes: '',
    discount: { mode: 'percent', value: '0.00' },
    currency: 'USD',
    subtotal: '140.00',
    discountAmount: '0.00',
    total: '140.00',
    amendmentCount: 0,
    voidedAt: null,
    voidReason: null,
    updatedAt: '2026-09-04T09:45:00.000Z',
    serverNow: '2026-09-04T10:00:00.000Z',
    ...extra,
  };
}

/** What a visit of 140 still owes after `paid`. */
export const balanceOf = (visit: VisitListItem, paid = '0.00'): VisitBalance => ({
  visitId: visit.id,
  currency: 'USD',
  charged: '140.00',
  paid,
  paidByPayments: paid,
  outstanding: (140 - Number(paid)).toFixed(2),
});
