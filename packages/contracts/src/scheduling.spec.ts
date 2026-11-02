import { describe, expect, it } from 'vitest';
import {
  bookAppointmentSchema,
  canCancel,
  canCheckIn,
  canConfirm,
  canMarkNoShow,
  canMove,
  canWriteAppointment,
  combineProposals,
  followUpDueOn,
  followUpExpiresOn,
  followUpOverdueDays,
  followUpSearchWindow,
  nextAppointmentPayloadSchema,
  openingDaySchema,
  openingHoursSchema,
  proposeNextAppointment,
  type ProposalPlan,
} from './scheduling.js';

const ME = '018f0000-0000-7000-8000-000000000001';
const OTHER = '018f0000-0000-7000-8000-000000000002';
const VISIT = '018f0000-0000-7000-8000-000000000003';

describe('canWriteAppointment', () => {
  it('lets write_all act on every column', () => {
    expect(
      canWriteAppointment(
        { permissions: ['appointment:write_all'], profileId: null },
        { dentistId: OTHER },
      ),
    ).toBe(true);
  });

  it('keeps write to the caller’s own column', () => {
    const actor = { permissions: ['appointment:write'] as const, profileId: ME };
    expect(canWriteAppointment(actor, { dentistId: ME })).toBe(true);
    expect(canWriteAppointment(actor, { dentistId: OTHER })).toBe(false);
  });

  it('refuses read-only callers and write without a profile', () => {
    expect(
      canWriteAppointment({ permissions: ['appointment:read'], profileId: ME }, { dentistId: ME }),
    ).toBe(false);
    expect(
      canWriteAppointment(
        { permissions: ['appointment:write'], profileId: null },
        { dentistId: ME },
      ),
    ).toBe(false);
  });
});

describe('what the status and time allow', () => {
  const at = (status: 'booked' | 'confirmed' | 'checked_in', localDate: string) => ({
    status,
    localDate,
    startsAt: `${localDate}T08:00:00.000Z`,
  });
  const today = '2026-10-30';

  it('checks in on the day only', () => {
    expect(canCheckIn(at('booked', today), today)).toBe(true);
    expect(canCheckIn(at('confirmed', '2026-10-31'), today)).toBe(false);
    expect(canCheckIn(at('checked_in', today), today)).toBe(false);
  });

  it('confirms and moves from today on', () => {
    expect(canConfirm(at('booked', today), today)).toBe(true);
    expect(canConfirm(at('confirmed', today), today)).toBe(false);
    expect(canConfirm(at('booked', '2026-10-29'), today)).toBe(false);
    expect(canMove(at('confirmed', today), today)).toBe(true);
    expect(canMove(at('booked', '2026-10-29'), today)).toBe(false);
    expect(canMove(at('checked_in', today), today)).toBe(false);
  });

  it('marks no-show once the start has passed, on any day', () => {
    expect(canMarkNoShow(at('booked', '2026-10-01'), new Date('2026-10-30T09:00:00Z'))).toBe(true);
    expect(canMarkNoShow(at('booked', today), new Date('2026-10-30T07:59:00Z'))).toBe(false);
  });

  it('cancels whatever has not arrived', () => {
    expect(canCancel(at('booked', '2026-10-01'))).toBe(true);
    expect(canCancel(at('confirmed', '2027-01-01'))).toBe(true);
    expect(canCancel(at('checked_in', today))).toBe(false);
  });
});

describe('follow-up dates', () => {
  it('derives the due date from the timing', () => {
    expect(followUpDueOn('asap', '2026-09-04', null)).toBe('2026-09-04');
    expect(followUpDueOn('within_1_week', '2026-09-04', null)).toBe('2026-09-11');
    expect(followUpDueOn('within_2_weeks', '2026-09-04', null)).toBe('2026-09-18');
    expect(followUpDueOn('within_1_month', '2026-09-04', null)).toBe('2026-10-04');
    expect(followUpDueOn('custom', '2026-09-04', '2026-12-01')).toBe('2026-12-01');
    expect(followUpDueOn('no_preference', '2026-09-04', null)).toBeNull();
  });

  it('adds the window across a month end', () => {
    expect(followUpExpiresOn('2026-12-20', 30)).toBe('2027-01-19');
  });

  it('counts the days past due', () => {
    expect(followUpOverdueDays('2026-09-01', '2026-09-04')).toBe(3);
    expect(followUpOverdueDays('2026-09-10', '2026-09-04')).toBe(0);
    expect(followUpOverdueDays(null, '2026-09-04')).toBe(0);
  });

  it('opens the slot finder on the due window, at least a week', () => {
    const today = '2026-09-04';
    const of = (dueOn: string | null) =>
      followUpSearchWindow({ dueOn, timing: 'within_1_week', customDate: null }, today);
    expect(of('2026-09-30')).toEqual({ from: today, to: '2026-09-30' });
    expect(of('2026-09-05')).toEqual({ from: today, to: '2026-09-11' });
    expect(of(null)).toEqual({ from: today, to: '2026-10-05' });
    expect(
      followUpSearchWindow(
        { dueOn: '2026-12-01', timing: 'custom', customDate: '2026-12-01' },
        today,
      ),
    ).toEqual({ from: '2026-12-01', to: '2026-12-08' });
  });
});

describe('proposeNextAppointment', () => {
  const plan = (id: number, patch: Partial<ProposalPlan>): ProposalPlan => ({
    id: `018f0000-0000-7000-8000-00000000010${id}`,
    name: `Plan ${id}`,
    status: 'planned',
    priority: 'elective',
    toothCode: null,
    estimatedSessions: null,
    sessions: [],
    ...patch,
  });

  it('puts this visit’s unfinished work first, with the next session', () => {
    const proposals = proposeNextAppointment(
      [
        plan(1, { status: 'in_progress', priority: 'urgent', sessions: [{ visitId: OTHER }] }),
        plan(2, {
          status: 'in_progress',
          priority: 'elective',
          estimatedSessions: 3,
          sessions: [{ visitId: OTHER }, { visitId: VISIT }],
        }),
      ],
      VISIT,
    );
    expect(proposals.map((proposal) => proposal.name)).toEqual(['Plan 2', 'Plan 1']);
    expect(proposals[0]).toMatchObject({
      kind: 'continue_treatment',
      sessionNumber: 3,
      sessionTotal: 3,
      durationMin: 60,
      timing: 'within_1_week',
    });
  });

  it('lists planned items by priority, the timing following it', () => {
    const proposals = proposeNextAppointment(
      [
        plan(1, { priority: 'elective' }),
        plan(2, { priority: 'urgent' }),
        plan(3, { priority: 'high' }),
      ],
      VISIT,
    );
    expect(proposals.map((proposal) => [proposal.name, proposal.timing])).toEqual([
      ['Plan 2', 'asap'],
      ['Plan 3', 'within_2_weeks'],
      ['Plan 1', 'within_1_month'],
    ]);
  });

  it('leaves out done and cancelled work', () => {
    expect(
      proposeNextAppointment(
        [plan(1, { status: 'performed' }), plan(2, { status: 'cancelled' })],
        VISIT,
      ),
    ).toEqual([]);
  });

  it('combines ticked proposals, capped at four hours', () => {
    const proposals = proposeNextAppointment(
      [
        plan(1, { priority: 'elective' }),
        plan(2, { priority: 'high' }),
        plan(3, { priority: 'high' }),
        plan(4, { priority: 'high' }),
        plan(5, { priority: 'high' }),
      ],
      VISIT,
    );
    expect(combineProposals(proposals)).toMatchObject({
      durationMin: 240,
      timing: 'within_2_weeks',
      priority: 'high',
    });
  });
});

describe('schemas', () => {
  it('needs a date for a custom timing', () => {
    const payload = { kind: 'other', title: 'Check', durationMin: 30, timing: 'custom' };
    expect(nextAppointmentPayloadSchema.safeParse(payload).success).toBe(false);
    expect(
      nextAppointmentPayloadSchema.safeParse({ ...payload, customDate: '2026-11-01' }).success,
    ).toBe(true);
  });

  it('defaults a booking to Auto, unconfirmed and no override', () => {
    const parsed = bookAppointmentSchema.parse({
      branchId: ME,
      patientId: OTHER,
      dentistId: VISIT,
      startsAt: '2026-10-30T08:00:00.000Z',
      durationMin: 30,
      reason: 'Check-up',
    });
    expect(parsed).toMatchObject({
      roomId: 'auto',
      confirmed: false,
      override: false,
      planIds: [],
    });
  });

  it('keeps opening hours in 15-minute steps, from before to', () => {
    const day = { weekday: 1, isOpen: true, from: '08:00', to: '18:00' };
    expect(openingDaySchema.safeParse(day).success).toBe(true);
    expect(openingDaySchema.safeParse({ ...day, to: '07:45' }).success).toBe(false);
    expect(openingDaySchema.safeParse({ ...day, to: '18:10' }).success).toBe(false);
    expect(openingDaySchema.safeParse({ ...day, isOpen: false, to: '07:45' }).success).toBe(true);
  });

  it('wants every weekday once', () => {
    const days = [0, 1, 2, 3, 4, 5, 5].map((weekday) => ({
      weekday,
      isOpen: true,
      from: '08:00',
      to: '18:00',
    }));
    expect(openingHoursSchema.safeParse({ days }).success).toBe(false);
  });
});
