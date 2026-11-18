import type { LabOrderSummary } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { filterOf, parseLabSearch } from './lab-search';
import { groupOpenOrders, summarise } from './lab-words';

const ID = '018f0000-0000-7000-8000-000000000001';

describe('the Lab screen URL', () => {
  it('drops what is malformed and keeps the rest', () => {
    expect(
      parseLabSearch({ tab: 'nope', status: 'at_lab', lab: 'x', late: 'true', q: ' ', order: ID }),
    ).toEqual({ status: 'at_lab', late: true, order: ID });
  });

  it('shows open orders by default, every status with all, and only the ids of a figure', () => {
    expect(filterOf({}).status).toBe('open');
    expect(filterOf({ status: 'all' }).status).toBeUndefined();
    expect(filterOf({ status: 'done' }).status).toBe('done');
    expect(filterOf({ ids: `${ID},${ID}`, status: 'done' })).toMatchObject({
      status: undefined,
      ids: [ID, ID],
    });
  });
});

const order = (
  id: string,
  patientId: string,
  kind: 'late' | 'arrived' | null,
  appointmentId?: string,
): LabOrderSummary =>
  ({
    id,
    patient: { id: patientId, fullName: 'Rami', displayNumber: 'P-000001' },
    appointment: appointmentId
      ? { id: appointmentId, startsAt: '', localDate: '', dentistName: '', status: 'booked' }
      : null,
    label:
      kind === null
        ? null
        : {
            kind,
            due: null,
            daysLate: kind === 'late' ? 2 : null,
            tone: kind,
            urgency: kind === 'late' ? 0 : 5,
          },
  }) as unknown as LabOrderSummary;

describe('labels for patients and appointments', () => {
  it('shows the most urgent of a patient’s open orders, with a count', () => {
    const orders = [
      order('a', 'p1', 'arrived'),
      order('b', 'p1', 'late', 'appt'),
      order('c', 'p2', null),
    ];
    const { byPatient, byAppointment } = groupOpenOrders(orders);
    expect(summarise(byPatient.get('p1') ?? [])).toMatchObject({
      label: { kind: 'late' },
      count: 2,
    });
    expect(summarise(byPatient.get('p2') ?? [])).toBeNull();
    expect(byAppointment.get('appt')?.map((row) => row.id)).toEqual(['b']);
  });
});
