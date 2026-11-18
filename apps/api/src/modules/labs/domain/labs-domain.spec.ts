import { describe, expect, it } from 'vitest';
import { accountFigures, type AccountSources, statement } from './lab-account';
import { defaultExpectedDays, expectedOn, isLate, nextOpenDay, shiftTripDates } from './lab-dates';
import { LabOrderTransitionError, LabUndoUnavailableError } from './lab-errors';
import { reportFigures } from './lab-reports';
import {
  assertCan,
  cancelTakesCharge,
  requireUndoPlan,
  statusAfterOutcome,
  undoableSteps,
  undoPlan,
} from './order-status';
import { lane, type LaneFacts } from './today-lane';

describe('order status', () => {
  it('refuses illegal moves', () => {
    expect(() => {
      assertCan('send', 'to_send');
    }).not.toThrow();
    expect(() => {
      assertCan('send', 'remake');
    }).not.toThrow();
    expect(() => {
      assertCan('send', 'at_lab');
    }).toThrow(LabOrderTransitionError);
    expect(() => {
      assertCan('receive', 'to_send');
    }).toThrow(LabOrderTransitionError);
    expect(() => {
      assertCan('hold', 'arrived');
    }).toThrow(LabOrderTransitionError);
    expect(() => {
      assertCan('hold', 'remake');
    }).toThrow(LabOrderTransitionError);
    expect(() => {
      assertCan('cancel', 'done');
    }).toThrow(LabOrderTransitionError);
    expect(() => {
      assertCan('cancel', 'arrived');
    }).not.toThrow();
    expect(() => {
      assertCan('edit', 'cancelled');
    }).toThrow(LabOrderTransitionError);
  });

  it('leads each outcome where B4 says', () => {
    expect(statusAfterOutcome('fitted')).toBe('done');
    expect(statusAfterOutcome('next_stage')).toBe('to_send');
    expect(statusAfterOutcome('adjustment')).toBe('to_send');
    expect(statusAfterOutcome('remake')).toBe('remake');
  });

  it('undoes one step back', () => {
    const sent = {
      status: 'at_lab' as const,
      cancelledFrom: null,
      trips: [{ receivedOn: null, outcome: null }],
    };
    expect(undoPlan('sent', sent)).toEqual({ status: 'to_send', trip: 'delete' });
    // A remake sent again goes back to Remake, not To send.
    const resent = {
      ...sent,
      trips: [
        { receivedOn: '2026-11-19', outcome: 'remake' as const },
        { receivedOn: null, outcome: null },
      ],
    };
    expect(undoPlan('sent', resent)).toEqual({ status: 'remake', trip: 'delete' });
    const arrived = {
      status: 'arrived' as const,
      cancelledFrom: null,
      trips: [{ receivedOn: '2026-11-19', outcome: null }],
    };
    expect(undoPlan('received', arrived)).toEqual({ status: 'at_lab', trip: 'unreceive' });
    expect(undoPlan('sent', arrived)).toBeNull();
    expect(undoPlan('done', { ...arrived, status: 'done' })).toEqual({
      status: 'arrived',
      trip: 'none',
    });
    const sentBack = {
      status: 'to_send' as const,
      cancelledFrom: null,
      trips: [{ receivedOn: '2026-11-19', outcome: 'next_stage' as const }],
    };
    expect(undoPlan('outcome', sentBack)).toEqual({ status: 'arrived', trip: 'clear_outcome' });
    const cancelled = { status: 'cancelled' as const, cancelledFrom: 'at_lab' as const, trips: [] };
    expect(undoPlan('cancel', cancelled)).toEqual({ status: 'at_lab', trip: 'none' });
    expect(undoableSteps(arrived)).toEqual(['received']);
    expect(() => requireUndoPlan('done', arrived)).toThrow(LabUndoUnavailableError);
  });

  it('asks a cancellation charge only for work sent and never delivered', () => {
    expect(cancelTakesCharge({ tripCount: 0, firstReceivedOn: null })).toBe(false);
    expect(cancelTakesCharge({ tripCount: 1, firstReceivedOn: null })).toBe(true);
    expect(cancelTakesCharge({ tripCount: 2, firstReceivedOn: '2026-11-19' })).toBe(false);
  });
});

describe('lab dates', () => {
  it('defaults the wait to the longest item turnaround, else the lab', () => {
    expect(defaultExpectedDays(7, [null, null])).toBe(7);
    expect(defaultExpectedDays(7, [4, null])).toBe(4);
    expect(defaultExpectedDays(7, [4, 10])).toBe(10);
  });

  it('expects the work the promised number of calendar days after sending', () => {
    // Sent Wed 11 Nov with a 7-day wait: due Wed 18 Nov.
    expect(expectedOn('2026-11-11', 7)).toBe('2026-11-18');
    expect(expectedOn('2026-12-28', 7)).toBe('2027-01-04');
  });

  it('is late only at the lab, the day after the expected date', () => {
    expect(isLate('at_lab', '2026-11-18', '2026-11-18')).toBe(false);
    expect(isLate('at_lab', '2026-11-18', '2026-11-19')).toBe(true);
    expect(isLate('on_hold', '2026-11-18', '2026-11-30')).toBe(false);
    expect(isLate('arrived', '2026-11-18', '2026-11-30')).toBe(false);
  });

  it('finds the next open day: Saturday gives Monday for a Mon–Sat clinic', () => {
    const monToSat = new Set([1, 2, 3, 4, 5, 6]);
    expect(nextOpenDay('2026-11-21', monToSat)).toBe('2026-11-23');
    expect(nextOpenDay('2026-11-19', monToSat)).toBe('2026-11-20');
    // Nothing open: tomorrow.
    expect(nextOpenDay('2026-11-21', new Set())).toBe('2026-11-22');
  });

  it('moves the promised and expected dates with a corrected sent date', () => {
    expect(
      shiftTripDates(
        { sentOn: '2026-11-11', promisedOn: '2026-11-18', expectedOn: '2026-11-20' },
        '2026-11-10',
      ),
    ).toEqual({ sentOn: '2026-11-10', promisedOn: '2026-11-17', expectedOn: '2026-11-19' });
  });
});

describe('Today lane', () => {
  const base: LaneFacts = {
    status: 'at_lab',
    priority: 'normal',
    expectedOn: '2026-11-25',
    appointmentDate: null,
    waitingSince: '2026-11-19',
    receivedOn: null,
    createdAt: '2026-11-19T08:00:00Z',
  };
  const today = '2026-11-19';
  const next = '2026-11-20';

  it('lists exceptions once, most urgent first', () => {
    const rows = lane(
      [
        { ...base, id: 'track' },
        // Expected within three days: on the lane; in four, not yet.
        { ...base, id: 'soon', expectedOn: '2026-11-22' },
        { ...base, id: 'later', expectedOn: '2026-11-23' },
        { ...base, id: 'book', status: 'arrived', receivedOn: '2026-11-18' },
        { ...base, id: 'unsent', status: 'to_send', expectedOn: null, waitingSince: '2026-11-17' },
        { ...base, id: 'fresh', status: 'to_send', expectedOn: null },
        // Late and due today: listed once, as late.
        { ...base, id: 'late', expectedOn: '2026-11-18', appointmentDate: today },
        { ...base, id: 'due', appointmentDate: next },
        {
          ...base,
          id: 'held',
          status: 'on_hold',
          expectedOn: '2026-11-01',
          appointmentDate: today,
        },
      ],
      today,
      next,
    );
    expect(rows.map((row) => [row.order.id, row.reason])).toEqual([
      ['late', 'late'],
      ['held', 'due'],
      ['due', 'due'],
      ['unsent', 'not_sent'],
      // Not sent yet, created today: listed at once, for *Mark sent*.
      ['fresh', 'not_sent'],
      ['soon', 'expected'],
      ['book', 'book'],
    ]);
  });

  it('puts urgent orders first within a reason', () => {
    const rows = lane(
      [
        { ...base, id: 'a', expectedOn: '2026-11-10' },
        { ...base, id: 'b', expectedOn: '2026-11-17', priority: 'urgent' },
      ],
      today,
      next,
    );
    expect(rows.map((row) => row.order.id)).toEqual(['b', 'a']);
  });
});

describe('lab account', () => {
  const sources: AccountSources = {
    lab: { id: 'lab', openingBalance: '300.00', openingBalanceOn: '2026-11-01' },
    orders: [
      {
        id: 'crown',
        displayNumber: 1,
        patientName: 'Rami',
        items: 'Zirconia crown',
        cost: '60.00',
        firstReceivedOn: '2026-11-19',
        cancelledOn: null,
        cancelCharge: null,
        hasTrip: true,
        remakeCharges: [],
      },
      {
        id: 'guard',
        displayNumber: 2,
        patientName: 'Rami',
        items: 'Night guard',
        cost: '35.00',
        firstReceivedOn: null,
        cancelledOn: null,
        cancelCharge: null,
        hasTrip: true,
        remakeCharges: [],
      },
    ],
    adjustments: [],
    payments: [],
  };

  it('owes the opening balance and the delivered work, not the work in progress', () => {
    expect(accountFigures(sources)).toEqual({
      owed: '360.00',
      paid: '0.00',
      outstanding: '360.00',
      inProgressCount: 1,
      inProgressAmount: '35.00',
    });
  });

  it('takes payments, ignores voided ones, credits and charges, and may go negative', () => {
    const paid: AccountSources = {
      ...sources,
      payments: [
        {
          id: 'p1',
          paidOn: '2026-11-20',
          amount: '200.00',
          method: 'cash',
          reference: null,
          voided: false,
          voidReason: null,
        },
        {
          id: 'p2',
          paidOn: '2026-11-20',
          amount: '999.00',
          method: 'cash',
          reference: null,
          voided: true,
          voidReason: 'typo',
        },
      ],
      adjustments: [
        { id: 'a1', onDate: '2026-11-21', kind: 'credit', amount: '10.00', reason: 'discount' },
      ],
    };
    expect(accountFigures(paid).outstanding).toBe('150.00');
    const credit = {
      ...paid,
      payments: [
        {
          id: 'p3',
          paidOn: '2026-11-20',
          amount: '400.00',
          method: 'cash' as const,
          reference: null,
          voided: false,
          voidReason: null,
        },
      ],
    };
    expect(accountFigures(credit).outstanding).toBe('-50.00');
  });

  it('counts remake and cancellation charges', () => {
    const charged: AccountSources = {
      ...sources,
      lab: { ...sources.lab, openingBalance: null, openingBalanceOn: null },
      orders: [
        {
          ...sources.orders[0]!,
          remakeCharges: [{ tripId: 't1', on: '2026-11-22', charge: '15.00' }],
        },
        { ...sources.orders[1]!, cancelledOn: '2026-11-22', cancelCharge: '20.00' },
      ],
    };
    expect(accountFigures(charged)).toMatchObject({ owed: '95.00', inProgressCount: 0 });
  });

  it('runs a statement with the balance before the period', () => {
    const paid: AccountSources = {
      ...sources,
      payments: [
        {
          id: 'p1',
          paidOn: '2026-11-20',
          amount: '200.00',
          method: 'cash',
          reference: 'R1',
          voided: false,
          voidReason: null,
        },
      ],
    };
    const result = statement(paid, '2026-11-15', '2026-11-30');
    expect(result.balanceBefore).toBe('300.00');
    expect(result.lines.map((line) => [line.kind, line.amount, line.balance])).toEqual([
      ['order', '60.00', '360.00'],
      ['payment', '-200.00', '160.00'],
    ]);
    expect(result.balanceAfter).toBe('160.00');
  });
});

describe('lab reports', () => {
  it('judges the lab against the promised date', () => {
    const figures = reportFigures(
      [
        {
          id: 'crown',
          cost: '60.00',
          firstReceivedOn: '2026-11-19',
          doneOn: '2026-11-19',
          cancelledOn: null,
          cancelCharge: null,
          trips: [
            {
              sentOn: '2026-11-11',
              promisedOn: '2026-11-18',
              receivedOn: '2026-11-19',
              outcome: null,
              outcomeOn: null,
              remakeBorneBy: null,
              remakeCharge: null,
            },
          ],
        },
        {
          id: 'remade',
          cost: '60.00',
          firstReceivedOn: '2026-11-15',
          doneOn: null,
          cancelledOn: null,
          cancelCharge: null,
          trips: [
            {
              sentOn: '2026-11-08',
              promisedOn: '2026-11-15',
              receivedOn: '2026-11-15',
              outcome: 'remake',
              outcomeOn: '2026-11-16',
              remakeBorneBy: 'lab',
              remakeCharge: null,
            },
          ],
        },
      ],
      '2026-11-01',
      '2026-11-30',
      true,
    );
    expect(figures).toMatchObject({
      sent: 2,
      received: 2,
      done: 1,
      avgTurnaroundDays: 7.5,
      onTimeRate: 0.5,
      avgDelayDays: 1,
      remakeRate: 0.5,
      remakeLabRate: 0.5,
      remakeClinicRate: 0,
      totalCost: '120.00',
      avgCost: '60.00',
    });
    expect(figures.orderIds.late).toEqual(['crown']);
    expect(reportFigures([], '2026-11-01', '2026-11-30', false)).toMatchObject({
      onTimeRate: null,
      totalCost: null,
    });
  });
});
