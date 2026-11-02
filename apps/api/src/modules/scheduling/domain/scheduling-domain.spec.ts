import type { OpeningDay } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { zonedInstant } from '../../../platform/kernel/local-date';
import { chooseRoom } from './auto-room';
import { type BookedSpan, evaluateConflicts, hardConflicts, softConflicts } from './conflicts';
import {
  compareWorklist,
  deriveFollowUp,
  invalidReasonOf,
  reopenedWindowFrom,
} from './follow-up-dates';
import { datesBetween, openingInterval, overlaps, plusMinutes, weekdayOf } from './intervals';
import { daySlots } from './slots';

const BEIRUT = 'Asia/Beirut';
/** Monday to Saturday 08:00–18:00, Sunday closed. */
const HOURS: OpeningDay[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isOpen: weekday !== 0,
  from: '08:00',
  to: '18:00',
}));
const at = (date: string, time: string) => zonedInstant(date, time, BEIRUT);
const span = (date: string, from: string, minutes: number) => ({
  start: at(date, from),
  end: plusMinutes(at(date, from), minutes),
});
/** Thursday. */
const DAY = '2026-10-29';

describe('intervals', () => {
  it('treats adjacent spans as free', () => {
    expect(overlaps(span(DAY, '09:00', 30), span(DAY, '09:30', 30))).toBe(false);
    expect(overlaps(span(DAY, '09:00', 31), span(DAY, '09:30', 30))).toBe(true);
    expect(overlaps(span(DAY, '09:00', 120), span(DAY, '09:30', 15))).toBe(true);
  });

  it('knows the weekday of a local date and walks a range', () => {
    expect(weekdayOf('2026-10-25')).toBe(0);
    expect(weekdayOf('2026-10-31')).toBe(6);
    expect(datesBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('gives no opening on a closed day and the local hours on both sides of DST', () => {
    expect(openingInterval('2026-10-25', HOURS, BEIRUT)).toBeNull();
    expect(openingInterval('2026-10-24', HOURS, BEIRUT)?.start.toISOString()).toBe(
      '2026-10-24T05:00:00.000Z',
    );
    expect(openingInterval('2026-10-26', HOURS, BEIRUT)?.start.toISOString()).toBe(
      '2026-10-26T06:00:00.000Z',
    );
  });
});

describe('evaluateConflicts', () => {
  const dentist = { id: 'd1', name: 'Dr. Reyes' };
  const room = { id: 'r1', name: 'Room 1' };
  const other = (patch: Partial<BookedSpan>): BookedSpan => ({
    ...span(DAY, '10:00', 30),
    dentistId: 'd2',
    patientId: 'p2',
    roomId: 'r2',
    ...patch,
  });
  const evaluate = (
    others: BookedSpan[],
    target = span(DAY, '10:00', 30),
    hours: OpeningDay[] = HOURS,
  ) =>
    evaluateConflicts({
      span: target,
      dentist,
      patientId: 'p1',
      room,
      others,
      hours,
      timeZone: BEIRUT,
    });

  it('finds nothing with nobody around', () => {
    expect(evaluate([])).toEqual([]);
    expect(
      evaluate([other({ roomId: 'r1', dentistId: 'd1', patientId: 'p1' })], span(DAY, '10:30', 30)),
    ).toEqual([]);
  });

  it('refuses the same room and the same patient', () => {
    const conflicts = evaluate([other({ roomId: 'r1' }), other({ patientId: 'p1' })]);
    expect(hardConflicts(conflicts).map((item) => item.kind)).toEqual(['room', 'patient']);
    expect(conflicts[0]).toMatchObject({ roomName: 'Room 1' });
  });

  it('warns on the same dentist, naming them', () => {
    const conflicts = evaluate([other({ dentistId: 'd1' })]);
    expect(softConflicts(conflicts)).toEqual([
      { kind: 'dentist', hard: false, roomName: null, dentistName: 'Dr. Reyes' },
    ]);
  });

  it('warns outside the hours, at either end', () => {
    expect(evaluate([], span(DAY, '18:30', 30)).map((item) => item.kind)).toEqual([
      'outside_hours',
    ]);
    expect(evaluate([], span(DAY, '17:45', 30)).map((item) => item.kind)).toEqual([
      'outside_hours',
    ]);
    expect(evaluate([], span(DAY, '07:45', 30)).map((item) => item.kind)).toEqual([
      'outside_hours',
    ]);
    expect(evaluate([], span(DAY, '17:30', 30))).toEqual([]);
  });

  it('warns on a closed day and a span past midnight', () => {
    expect(evaluate([], span('2026-10-25', '10:00', 30)).map((item) => item.kind)).toEqual([
      'closed_day',
    ]);
    expect(evaluate([], span(DAY, '23:45', 30)).map((item) => item.kind)).toEqual([
      'outside_hours',
    ]);
  });

  it('follows custom hours', () => {
    const saturdayShort = HOURS.map((day) => (day.weekday === 6 ? { ...day, to: '13:00' } : day));
    expect(evaluate([], span('2026-10-31', '13:00', 30), saturdayShort)[0]?.kind).toBe(
      'outside_hours',
    );
  });
});

describe('chooseRoom', () => {
  const rooms = [
    { id: 'r1', name: 'Room 1' },
    { id: 'r2', name: 'Room 2' },
    { id: 'r3', name: 'Room 3' },
  ];

  it('takes the usual room when free', () => {
    expect(chooseRoom(rooms, 'r2', () => true)).toMatchObject({
      room: { id: 'r2' },
      isUsual: true,
    });
  });

  it('takes the first free room when the usual one is in use', () => {
    expect(chooseRoom(rooms, 'r1', (id) => id === 'r3')).toMatchObject({
      room: { id: 'r3' },
      usualRoom: { id: 'r1' },
      isUsual: false,
    });
  });

  it('books without a room when none is free', () => {
    expect(chooseRoom(rooms, 'r1', () => false)).toMatchObject({ room: null, isUsual: false });
  });

  it('ignores a usual room that is not in the branch any more', () => {
    expect(chooseRoom(rooms, 'gone', () => true)).toMatchObject({
      room: { id: 'r1' },
      usualRoom: null,
      isUsual: false,
    });
  });

  it('copes with a branch without rooms', () => {
    expect(chooseRoom([], null, () => true).room).toBeNull();
  });
});

describe('daySlots', () => {
  const base = {
    hours: HOURS,
    timeZone: BEIRUT,
    durationMin: 30,
    stepMin: 30,
    now: at('2026-10-01', '00:00'),
    busy: [],
  };
  const clock = (date: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: BEIRUT,
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  const starts = (input: Parameters<typeof daySlots>[0]) =>
    daySlots(input).map((slot) => clock(slot.start));

  it('fills the opening on the grid, the last start ending at closing', () => {
    const found = starts({ ...base, date: DAY });
    expect(found[0]).toBe('08:00');
    expect(found.at(-1)).toBe('17:30');
    expect(found).toHaveLength(20);
  });

  it('aligns to the grid of the day, not to the opening', () => {
    const hours = HOURS.map((day) => ({ ...day, from: '08:15' }));
    expect(starts({ ...base, date: DAY, hours })[0]).toBe('08:30');
  });

  it('skips a closed day', () => {
    expect(daySlots({ ...base, date: '2026-10-25' })).toEqual([]);
  });

  it('never starts in the past', () => {
    expect(starts({ ...base, date: DAY, now: at(DAY, '12:10') })[0]).toBe('12:30');
  });

  it('removes every busy list, allowing adjacent starts', () => {
    const found = starts({
      ...base,
      date: DAY,
      busy: [[span(DAY, '09:00', 60)], [span(DAY, '11:00', 15)]],
    });
    expect(found).toContain('08:30');
    expect(found).not.toContain('09:00');
    expect(found).not.toContain('09:30');
    expect(found).toContain('10:00');
    expect(found).not.toContain('11:00');
    expect(found).toContain('11:30');
  });

  it('keeps a start only when the whole duration fits', () => {
    const found = starts({ ...base, date: DAY, durationMin: 60, busy: [[span(DAY, '09:30', 15)]] });
    expect(found).toContain('08:30');
    expect(found).not.toContain('09:00');
    expect(found.at(-1)).toBe('17:00');
  });

  it('stays on local time across both DST changes', () => {
    // Clocks went back on 25 Oct 2026; Saturday before and Monday after open at 08:00 local.
    expect(starts({ ...base, date: '2026-10-24' })[0]).toBe('08:00');
    expect(starts({ ...base, date: '2026-10-26' })[0]).toBe('08:00');
    // Clocks go forward on 28 Mar 2027 at midnight, a Sunday opened for the test.
    const sunday = HOURS.map((day) => ({ ...day, isOpen: true }));
    const springDay = { ...base, date: '2027-03-28', hours: sunday };
    expect(starts(springDay)[0]).toBe('08:00');
    expect(new Set(starts(springDay)).size).toBe(20);
  });

  it('adds the warned starts for move mode', () => {
    const slots = daySlots({
      ...base,
      date: DAY,
      includeWarnings: true,
      warnedBusy: [span(DAY, '10:00', 30)],
    });
    expect(slots.find((slot) => clock(slot.start) === '10:00')?.warnings).toEqual(['dentist']);
    expect(slots.find((slot) => clock(slot.start) === '18:30')?.warnings).toEqual([
      'outside_hours',
    ]);
    expect(slots.find((slot) => clock(slot.start) === '09:00')?.warnings).toEqual([]);
  });

  it('marks every start of a closed day for move mode', () => {
    const slots = daySlots({ ...base, date: '2026-10-25', includeWarnings: true });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.warnings.includes('closed_day'))).toBe(true);
  });

  it('keeps hard conflicts out of move mode', () => {
    const found = starts({
      ...base,
      date: DAY,
      includeWarnings: true,
      busy: [[span(DAY, '10:00', 30)]],
    });
    expect(found).not.toContain('10:00');
  });
});

describe('follow-up dates', () => {
  const awaiting = { status: 'awaiting' as const, dueOn: '2026-09-11', windowFrom: '2026-09-11' };

  it('derives overdue days and keeps it on the list through the window', () => {
    expect(deriveFollowUp(awaiting, 30, '2026-09-14')).toEqual({
      expiresOn: '2026-10-11',
      expired: false,
      overdueDays: 3,
    });
    expect(deriveFollowUp(awaiting, 30, '2026-10-11').expired).toBe(false);
  });

  it('expires the day after the window, and follows a changed window', () => {
    expect(deriveFollowUp(awaiting, 30, '2026-10-12').expired).toBe(true);
    expect(deriveFollowUp(awaiting, 60, '2026-10-12').expired).toBe(false);
  });

  it('never expires one that is not awaiting', () => {
    expect(deriveFollowUp({ ...awaiting, status: 'booked' }, 30, '2027-01-01')).toMatchObject({
      expired: false,
      overdueDays: 0,
    });
  });

  it('runs without a due date from the visit date', () => {
    const undated = { status: 'awaiting' as const, dueOn: null, windowFrom: '2026-09-01' };
    expect(deriveFollowUp(undated, 30, '2026-09-20')).toMatchObject({
      overdueDays: 0,
      expired: false,
    });
  });

  it('restarts the window on a later reopening, never moving it back (G7)', () => {
    expect(reopenedWindowFrom('2026-09-01', '2026-10-14')).toBe('2026-10-14');
    expect(reopenedWindowFrom('2026-11-01', '2026-10-14')).toBe('2026-11-01');
    const reopened = { ...awaiting, windowFrom: reopenedWindowFrom('2026-09-01', '2026-10-14') };
    expect(deriveFollowUp(reopened, 30, '2026-10-15').expired).toBe(false);
  });

  it('sorts the worklist: earliest due first, none last', () => {
    const row = (dueOn: string | null, day = 1) => ({
      dueOn,
      createdAt: new Date(Date.UTC(2026, 8, day)),
    });
    const sorted = [row(null), row('2026-09-20'), row('2026-09-01'), row('2026-09-20', 0)].sort(
      compareWorklist,
    );
    expect(sorted.map((item) => item.dueOn)).toEqual([
      '2026-09-01',
      '2026-09-20',
      '2026-09-20',
      null,
    ]);
    expect(sorted[1]?.createdAt.getUTCDate()).toBe(31);
  });

  it('says when the plan behind it moved on (G20)', () => {
    expect(invalidReasonOf([])).toBeNull();
    expect(invalidReasonOf(['planned'])).toBeNull();
    expect(invalidReasonOf(['performed', 'in_progress'])).toBeNull();
    expect(invalidReasonOf(['cancelled'])).toBe('plan_cancelled');
    expect(invalidReasonOf(['performed'])).toBe('plan_done');
    expect(invalidReasonOf(['performed', 'cancelled'])).toBe('plan_cancelled');
  });
});
