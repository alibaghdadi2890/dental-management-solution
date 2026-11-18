import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatLabOrderNumber,
  labOrderItemInputSchema,
  labOrderLabel,
  type LabOrderSummary,
  labWorkForNextAppointment,
  mostUrgentLabel,
  parseLabOrderNumber,
} from './labs.js';

const TODAY = '2026-11-19';

describe('labOrderLabel', () => {
  it('has no label for a closed order', () => {
    for (const status of ['done', 'cancelled'] as const) {
      expect(labOrderLabel({ status, expectedOn: null, appointmentDate: null }, TODAY)).toBeNull();
    }
  });

  it('is late the day after the expected date, never on it', () => {
    const on = labOrderLabel({ status: 'at_lab', expectedOn: TODAY, appointmentDate: null }, TODAY);
    expect(on).toMatchObject({ kind: 'due_soon', due: TODAY, daysLeft: 0, tone: 'on_track' });
    const after = labOrderLabel(
      { status: 'at_lab', expectedOn: '2026-11-18', appointmentDate: null },
      TODAY,
    );
    expect(after).toMatchObject({ kind: 'late', daysLate: 1, tone: 'late', urgency: 0 });
  });

  it('is due soon from three days before the expected date, sent before that', () => {
    const label = (expectedOn: string) =>
      labOrderLabel({ status: 'at_lab', expectedOn, appointmentDate: null }, TODAY);
    expect(label('2026-11-22')).toMatchObject({ kind: 'due_soon', daysLeft: 3, urgency: 1 });
    expect(label('2026-11-23')).toMatchObject({ kind: 'at_lab', daysLeft: null });
  });

  it('is at risk when the appointment is on or before the expected day', () => {
    const base = { status: 'at_lab' as const, expectedOn: '2026-11-25' };
    expect(labOrderLabel({ ...base, appointmentDate: '2026-11-25' }, TODAY)?.tone).toBe('at_risk');
    expect(labOrderLabel({ ...base, appointmentDate: '2026-11-26' }, TODAY)?.tone).toBe('on_track');
  });

  it('shows arrived, on hold, remake and to send', () => {
    const label = (status: 'arrived' | 'on_hold' | 'remake' | 'to_send') =>
      labOrderLabel({ status, expectedOn: '2026-11-01', appointmentDate: null }, TODAY);
    expect(label('arrived')).toMatchObject({ kind: 'arrived', tone: 'arrived' });
    // On hold is never late, even past its date.
    expect(label('on_hold')).toMatchObject({ kind: 'on_hold', daysLate: null });
    expect(label('remake')?.kind).toBe('remake');
    expect(label('to_send')?.kind).toBe('to_send');
  });

  it('picks the most urgent of several', () => {
    const arrived = labOrderLabel(
      { status: 'arrived', expectedOn: null, appointmentDate: null },
      TODAY,
    );
    const late = labOrderLabel(
      { status: 'at_lab', expectedOn: '2026-11-10', appointmentDate: null },
      TODAY,
    );
    expect(mostUrgentLabel([arrived, null, late])?.kind).toBe('late');
    expect(mostUrgentLabel([])).toBeNull();
  });
});

describe('order numbers and dates', () => {
  it('formats and parses numbers', () => {
    expect(formatLabOrderNumber(42)).toBe('L-000042');
    expect(parseLabOrderNumber('L-000042')).toBe(42);
    expect(parseLabOrderNumber('l42')).toBe(42);
    expect(parseLabOrderNumber('42')).toBe(42);
    expect(parseLabOrderNumber('Rami')).toBeNull();
  });

  it('counts calendar days', () => {
    expect(addDays('2026-11-11', 7)).toBe('2026-11-18');
    expect(daysBetween('2026-11-11', '2026-11-19')).toBe(8);
    // Across the end of DST in Europe (25 Oct): still whole days.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('labOrderItemInputSchema', () => {
  it('needs a service or a description, and teeth only for teeth', () => {
    expect(labOrderItemInputSchema.safeParse({ target: 'upper' }).success).toBe(false);
    expect(
      labOrderItemInputSchema.safeParse({ description: 'Night guard', target: 'upper' }).success,
    ).toBe(true);
    expect(
      labOrderItemInputSchema.safeParse({ description: 'Crown', target: 'teeth' }).success,
    ).toBe(false);
    expect(
      labOrderItemInputSchema.safeParse({ description: 'Crown', target: 'upper', teeth: ['26'] })
        .success,
    ).toBe(false);
    expect(
      labOrderItemInputSchema.safeParse({ description: 'Crown', target: 'teeth', teeth: ['26'] })
        .success,
    ).toBe(true);
  });
});

describe('labWorkForNextAppointment', () => {
  const PATIENT = '00000000-0000-7000-8000-000000000001';
  const THIS_APPOINTMENT = '00000000-0000-7000-8000-0000000000a1';
  const visit = { patientId: PATIENT, appointmentId: THIS_APPOINTMENT, localDate: TODAY };
  const order = (n: number, extra: Partial<LabOrderSummary> = {}): LabOrderSummary => ({
    id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    displayNumber: n,
    patient: { id: PATIENT, fullName: 'Rana Haddad', displayNumber: 'P-000001' },
    dentistId: '00000000-0000-7000-8000-0000000000d1',
    dentistName: 'Dr Sami',
    labId: '00000000-0000-7000-8000-0000000000b1',
    labName: 'Cedar Lab',
    labPhone: null,
    branchId: '00000000-0000-7000-8000-0000000000c1',
    visitId: null,
    appointment: null,
    status: 'to_send',
    priority: 'normal',
    submission: 'physical',
    items: [],
    planIds: [],
    expectedDays: 7,
    sentOn: null,
    expectedOn: null,
    promisedOn: null,
    receivedOn: null,
    firstReceivedOn: null,
    waitingSince: TODAY,
    tripCount: 0,
    label: null,
    cost: null,
    currency: 'USD',
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...extra,
  });
  const appointment = (id: string) => ({
    id,
    startsAt: '2026-11-26T09:00:00.000Z',
    localDate: '2026-11-26',
    dentistName: 'Dr Sami',
    status: 'booked',
  });
  const ready = (orders: LabOrderSummary[]) =>
    labWorkForNextAppointment(orders, visit).map((row) => [row.order.displayNumber, row.readyOn]);

  it('is ready when the work can be back: arrived today, at the lab on its expected date, not sent after the wait', () => {
    expect(
      ready([
        order(1),
        order(2, { status: 'at_lab', sentOn: '2026-11-16', expectedOn: '2026-11-23' }),
        order(3, { status: 'arrived', expectedOn: '2026-11-17' }),
      ]),
    ).toEqual([
      [3, TODAY],
      [2, '2026-11-23'],
      [1, '2026-11-26'],
    ]);
  });

  it('waits the whole turnaround again for work sent back, whatever the last trip expected', () => {
    const returned = {
      sentOn: '2026-11-05',
      expectedOn: '2026-11-12',
      receivedOn: '2026-11-12',
      tripCount: 1,
    };
    expect(
      ready([
        order(1, { ...returned, status: 'to_send' }),
        order(2, { ...returned, status: 'remake' }),
      ]),
    ).toEqual([
      [1, '2026-11-26'],
      [2, '2026-11-26'],
    ]);
  });

  it('is never ready before the visit: late work is wanted at once', () => {
    expect(
      ready([order(1, { status: 'at_lab', sentOn: '2026-11-08', expectedOn: '2026-11-15' })]),
    ).toEqual([[1, TODAY]]);
  });

  it('leaves out closed work, other patients, and work another appointment is waiting for', () => {
    expect(
      ready([
        order(1, { status: 'done' }),
        order(2, { status: 'cancelled' }),
        order(3, {
          patient: {
            id: '00000000-0000-7000-8000-000000000002',
            fullName: 'Omar',
            displayNumber: 'P-000002',
          },
        }),
        order(4, { appointment: appointment('00000000-0000-7000-8000-0000000000a2') }),
        order(5, { appointment: appointment(THIS_APPOINTMENT), status: 'remake' }),
        order(6, { status: 'on_hold', sentOn: '2026-11-17', expectedOn: '2026-11-24' }),
      ]),
    ).toEqual([
      [6, '2026-11-24'],
      [5, '2026-11-26'],
    ]);
  });
});
