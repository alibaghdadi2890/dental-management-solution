import type { LabOrderSummary } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { needsAttention } from './needs-attention';

const lab = (id: string, status: LabOrderSummary['status'], late: boolean, appointment: boolean) =>
  ({
    id,
    status,
    appointment: appointment ? { id: 'appt' } : null,
    label: late
      ? { kind: 'late', due: null, daysLate: 1, tone: 'late', urgency: 0 }
      : { kind: status, due: null, daysLate: null, tone: 'arrived', urgency: 5 },
  }) as unknown as LabOrderSummary;

describe('needsAttention: lab work (feature 18)', () => {
  it('puts late work and arrived work without an appointment first', () => {
    const items = needsAttention({
      chart: undefined,
      owed: null,
      hasVisits: false,
      missing: [],
      labOrders: [
        lab('booked', 'arrived', false, true),
        lab('loose', 'arrived', false, false),
        lab('late', 'at_lab', true, true),
      ],
    });
    expect(
      items.map((item) => ('order' in item ? `${item.kind}:${item.order.id}` : item.kind)),
    ).toEqual(['labLate:late', 'labBook:loose', 'examination']);
  });
});
