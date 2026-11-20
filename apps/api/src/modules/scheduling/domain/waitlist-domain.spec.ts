import type { OpeningDay } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';
import { plusMinutes } from './intervals';
import {
  type DentistBusy,
  type FreedSlot,
  findOpenings,
  freeRuns,
  type Opening,
  openingOf,
  union,
} from './openings';
import { type FitContext, type FitEntry, startsFor } from './waitlist-fit';
import { compareFair } from './waitlist-order';

const BEIRUT = 'Asia/Beirut';
/** Monday to Saturday 08:00–18:00, Sunday closed: the acceptance clinic. */
const HOURS: OpeningDay[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isOpen: weekday !== 0,
  from: '08:00',
  to: '18:00',
}));
const at = (date: string, time: string) => zonedInstant(date, time, BEIRUT);
const REYES = 'dentist-reyes';
const LEE = 'dentist-lee';
/** Thu 19 Nov 2026, 09:00: the acceptance's now. */
const NOW = at('2026-11-19', '09:00');
const TUE = '2026-11-24';
const THU = '2026-11-26';

const freed = (id: string, date: string, from: string, minutes: number, dentistId = REYES) => ({
  appointmentId: id,
  dentistId,
  start: at(date, from),
  end: plusMinutes(at(date, from), minutes),
});
const busy = (date: string, from: string, minutes: number, dentistId = REYES): DentistBusy => ({
  dentistId,
  start: at(date, from),
  end: plusMinutes(at(date, from), minutes),
});

const openings = (
  slots: FreedSlot[],
  taken: DentistBusy[] = [],
  options: { hours?: OpeningDay[]; now?: Date; timeZone?: string } = {},
) =>
  findOpenings({
    freed: slots,
    busy: taken,
    hours: options.hours ?? HOURS,
    timeZone: options.timeZone ?? BEIRUT,
    now: options.now ?? NOW,
  });

const clockOf = (instant: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: BEIRUT,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);

const spanOf = (opening: Opening | undefined) =>
  opening ? `${clockOf(opening.start)}–${clockOf(opening.end)}` : 'none';

describe('union and free runs', () => {
  it('joins overlapping and adjacent spans', () => {
    const joined = union([
      { start: at(TUE, '10:00'), end: at(TUE, '11:00') },
      { start: at(TUE, '11:00'), end: at(TUE, '11:30') },
      { start: at(TUE, '10:30'), end: at(TUE, '10:45') },
      { start: at(TUE, '13:00'), end: at(TUE, '14:00') },
    ]);
    expect(joined.map((span) => `${clockOf(span.start)}–${clockOf(span.end)}`)).toEqual([
      '10:00–11:30',
      '13:00–14:00',
    ]);
  });

  it('leaves the free runs of a window between busy spans', () => {
    const runs = freeRuns({ start: at(TUE, '08:00'), end: at(TUE, '18:00') }, [
      { start: at(TUE, '07:00'), end: at(TUE, '09:00') },
      { start: at(TUE, '12:00'), end: at(TUE, '13:00') },
      { start: at(TUE, '17:00'), end: at(TUE, '19:00') },
    ]);
    expect(runs.map((span) => `${clockOf(span.start)}–${clockOf(span.end)}`)).toEqual([
      '09:00–12:00',
      '13:00–17:00',
    ]);
  });
});

describe('what an opening is (B1)', () => {
  // Dr. Reyes is booked all Tuesday afternoon; Kenji's 15:00–16:00 is cancelled.
  const afternoon = [busy(TUE, '08:00', 360), busy(TUE, '14:00', 60), busy(TUE, '16:00', 120)];

  it('is the freed slot between two neighbouring appointments', () => {
    const found = openings([freed('kenji', TUE, '15:00', 60)], afternoon);
    expect(found).toHaveLength(1);
    expect(spanOf(found[0])).toBe('15:00–16:00');
    expect(found[0]?.id).toBe('kenji');
    expect(found[0]?.date).toBe(TUE);
  });

  it('joins a 30-minute cancellation to the 30 free minutes beside it', () => {
    const found = openings(
      [freed('a', TUE, '15:00', 30)],
      [busy(TUE, '08:00', 420), busy(TUE, '16:00', 120)],
    );
    expect(spanOf(found[0])).toBe('15:00–16:00');
    expect(found[0]?.freed.map((part) => clockOf(part.start))).toEqual(['15:00']);
  });

  it('spreads over an empty day but keeps the freed part', () => {
    const found = openings([freed('a', TUE, '10:00', 60)]);
    expect(spanOf(found[0])).toBe('08:00–18:00');
    expect(found[0]?.freed).toEqual([{ start: at(TUE, '10:00'), end: at(TUE, '11:00') }]);
  });

  it('is bounded by now on today, and needs a start still ahead', () => {
    const today = '2026-11-19';
    expect(spanOf(openings([freed('a', today, '10:00', 60)])[0])).toBe('09:00–18:00');
    const started = openings([freed('a', today, '10:00', 60)], [], { now: at(today, '10:15') });
    expect(started).toEqual([]);
  });

  it('ends when the freed slot is booked again, and shrinks when part of it is', () => {
    expect(
      openings([freed('a', TUE, '15:00', 60)], [...afternoon, busy(TUE, '15:00', 60)]),
    ).toEqual([]);
    const part = openings([freed('a', TUE, '15:00', 60)], [...afternoon, busy(TUE, '15:00', 30)]);
    expect(spanOf(part[0])).toBe('15:30–16:00');
  });

  it('needs 15 minutes of freed time: 15 is one, 10 is none', () => {
    const fifteen = openings(
      [freed('a', TUE, '15:00', 60)],
      [...afternoon, busy(TUE, '15:00', 45)],
    );
    expect(spanOf(fifteen[0])).toBe('15:45–16:00');
    const ten = openings([freed('a', TUE, '15:00', 60)], [...afternoon, busy(TUE, '15:00', 50)]);
    expect(ten).toEqual([]);
  });

  it('is none on a closed day and stops at the opening hours', () => {
    expect(openings([freed('a', '2026-11-22', '10:00', 60)])).toEqual([]);
    const late = openings([freed('a', TUE, '17:30', 60)], [busy(TUE, '08:00', 570)]);
    expect(spanOf(late[0])).toBe('17:30–18:00');
    expect(openings([freed('a', TUE, '18:00', 60)])).toEqual([]);
  });

  it('follows the opening hours as they are now', () => {
    const shorter = HOURS.map((day) => (day.weekday === 2 ? { ...day, to: '15:30' } : day));
    const found = openings([freed('kenji', TUE, '15:00', 60)], afternoon, { hours: shorter });
    expect(spanOf(found[0])).toBe('15:00–15:30');
  });

  it("counts the dentist's appointments in another branch, never another dentist's", () => {
    const found = openings(
      [freed('a', TUE, '15:00', 60)],
      [busy(TUE, '08:00', 420), busy(TUE, '15:30', 30), busy(TUE, '16:00', 120, LEE)],
    );
    expect(spanOf(found[0])).toBe('15:00–15:30');
  });

  it('is one opening when the same time was freed twice', () => {
    const found = openings([freed('a', TUE, '15:00', 60), freed('b', TUE, '15:00', 60)], afternoon);
    expect(found).toHaveLength(1);
    expect(found[0]?.freedAppointmentIds).toEqual(['a', 'b']);
  });

  it('splits around a booking in its middle, found by its id and an instant', () => {
    const found = openings(
      [freed('a', TUE, '15:00', 60)],
      [...afternoon, busy(TUE, '15:15', 15)].filter((span) => span !== afternoon[1]),
    ).filter((opening) => opening.freedAppointmentIds.includes('a'));
    expect(found.map(spanOf)).toEqual(['14:00–15:15', '15:30–16:00']);
    expect(spanOf(openingOf(found, 'a') ?? undefined)).toBe('14:00–15:15');
    expect(spanOf(openingOf(found, 'a', at(TUE, '15:30')) ?? undefined)).toBe('15:30–16:00');
    expect(openingOf(found, 'a', at(TUE, '15:20'))).toBeNull();
    expect(openingOf(found, 'unknown')).toBeNull();
  });

  it('keeps each dentist apart, soonest first', () => {
    const found = openings(
      [freed('lee', TUE, '09:00', 30, LEE), freed('reyes', TUE, '08:00', 30)],
      [busy(TUE, '08:30', 570), busy(TUE, '09:30', 510, LEE), busy(TUE, '08:00', 30, LEE)],
    );
    expect(found.map((opening) => [opening.dentistId, spanOf(opening)])).toEqual([
      [REYES, '08:00–08:30'],
      [LEE, '08:30–09:30'],
    ]);
  });

  it('groups by the clinic-local day across midnight', () => {
    const allDay = HOURS.map((day) => ({ ...day, isOpen: true, from: '00:00', to: '23:45' }));
    // 00:30 in Beirut is 22:30 UTC the evening before.
    const found = openings([freed('a', THU, '00:30', 30)], [], { hours: allDay });
    expect(found[0]?.date).toBe(THU);
    expect(localDate(found[0]?.start ?? NOW, BEIRUT)).toBe(THU);
    expect(spanOf(found[0])).toBe('00:00–23:45');
  });
});

describe('who fits (B2)', () => {
  const context: FitContext = { branchId: 'main', timeZone: BEIRUT, today: '2026-11-19' };
  const entry = (overrides: Partial<FitEntry> = {}): FitEntry => ({
    id: 'entry',
    branchId: 'main',
    dentistId: REYES,
    durationMin: 60,
    weekdays: [],
    betweenFrom: null,
    betweenTo: null,
    notBefore: null,
    sameDay: false,
    until: '2026-12-19',
    appointmentStart: null,
    patientBusy: [],
    ...overrides,
  });
  const kenji = openings(
    [freed('kenji', TUE, '15:00', 60)],
    [busy(TUE, '08:00', 360), busy(TUE, '14:00', 60), busy(TUE, '16:00', 120)],
  )[0] as Opening;
  const clocks = (starts: Date[]) => starts.map(clockOf);

  it("starts at the freed slot's start", () => {
    expect(clocks(startsFor(entry(), kenji, context))).toEqual(['15:00']);
  });

  it('does not list a 60-minute entry in a 30-minute opening', () => {
    const short = openings(
      [freed('a', TUE, '15:00', 30)],
      [busy(TUE, '08:00', 420), busy(TUE, '15:30', 150)],
    )[0] as Opening;
    expect(startsFor(entry(), short, context)).toEqual([]);
    expect(clocks(startsFor(entry({ durationMin: 30 }), short, context))).toEqual(['15:00']);
  });

  it('lists it when the 30 free minutes beside the cancellation join it', () => {
    const joined = openings(
      [freed('a', TUE, '15:00', 30)],
      [busy(TUE, '08:00', 420), busy(TUE, '16:00', 120)],
    )[0] as Opening;
    expect(clocks(startsFor(entry(), joined, context))).toEqual(['15:00']);
    expect(clocks(startsFor(entry({ durationMin: 30 }), joined, context))).toEqual([
      '15:00',
      '15:15',
    ]);
  });

  it('on an empty day offers only starts that use the cancelled slot', () => {
    const empty = openings([freed('a', TUE, '10:00', 60)])[0] as Opening;
    expect(clocks(startsFor(entry({ durationMin: 30 }), empty, context))).toEqual([
      '10:00',
      '09:45',
      '10:15',
      '10:30',
      '10:45',
    ]);
  });

  it('keeps an odd freed start and the grid', () => {
    const odd = openings(
      [freed('a', TUE, '10:10', 50)],
      [busy(TUE, '08:00', 130), busy(TUE, '11:00', 420)],
    )[0] as Opening;
    expect(clocks(startsFor(entry({ durationMin: 30 }), odd, context))).toEqual([
      '10:10',
      '10:15',
      '10:30',
    ]);
  });

  it('keeps the chosen days', () => {
    const thursday = openings(
      [freed('a', THU, '10:00', 60)],
      [busy(THU, '08:00', 120), busy(THU, '11:00', 420)],
    )[0] as Opening;
    expect(startsFor(entry({ weekdays: [1, 2, 3] }), thursday, context)).toEqual([]);
    expect(startsFor(entry({ weekdays: [4] }), thursday, context)).toHaveLength(1);
    expect(startsFor(entry({ weekdays: [1, 2, 3] }), kenji, context)).toHaveLength(1);
  });

  it('keeps the whole appointment inside Between', () => {
    const wide = openings(
      [freed('a', TUE, '13:30', 90)],
      [busy(TUE, '08:00', 330), busy(TUE, '15:00', 180)],
    )[0] as Opening;
    const afternoonOnly = entry({ betweenFrom: '14:00', betweenTo: '18:00' });
    expect(clocks(startsFor(afternoonOnly, wide, context))).toEqual(['14:00']);
    expect(clocks(startsFor({ ...afternoonOnly, durationMin: 30 }, wide, context))).toEqual([
      '14:00',
      '14:15',
      '14:30',
    ]);
    expect(startsFor(entry({ betweenFrom: '14:00', betweenTo: '15:30' }), kenji, context)).toEqual(
      [],
    );
  });

  it('needs Same day for an opening today', () => {
    const today = openings(
      [freed('a', '2026-11-19', '15:00', 60)],
      [busy('2026-11-19', '09:00', 360), busy('2026-11-19', '16:00', 120)],
    )[0] as Opening;
    expect(startsFor(entry(), today, context)).toEqual([]);
    expect(startsFor(entry({ sameDay: true }), today, context)).toHaveLength(1);
  });

  it('never lists an opening later than the appointment brought forward', () => {
    expect(startsFor(entry({ appointmentStart: at(TUE, '15:00') }), kenji, context)).toEqual([]);
    expect(startsFor(entry({ appointmentStart: at(TUE, '14:59') }), kenji, context)).toEqual([]);
    expect(
      startsFor(
        entry({ appointmentStart: at('2026-12-10', '10:00'), until: null }),
        kenji,
        context,
      ),
    ).toHaveLength(1);
  });

  it('keeps Not before and Until', () => {
    expect(startsFor(entry({ notBefore: '2026-12-01' }), kenji, context)).toEqual([]);
    expect(startsFor(entry({ notBefore: TUE }), kenji, context)).toHaveLength(1);
    expect(startsFor(entry({ until: '2026-11-23' }), kenji, context)).toEqual([]);
    expect(startsFor(entry({ until: TUE }), kenji, context)).toHaveLength(1);
  });

  it("fits a named dentist's openings only; Any dentist fits both", () => {
    const lee = { ...kenji, dentistId: LEE };
    expect(startsFor(entry(), lee, context)).toEqual([]);
    expect(startsFor(entry({ dentistId: null }), lee, context)).toHaveLength(1);
    expect(startsFor(entry({ dentistId: null }), kenji, context)).toHaveLength(1);
  });

  it('leaves out a patient booked elsewhere at that time, and another branch', () => {
    const elsewhere = [{ start: at(TUE, '15:30'), end: at(TUE, '16:30') }];
    expect(startsFor(entry({ patientBusy: elsewhere }), kenji, context)).toEqual([]);
    expect(
      clocks(startsFor(entry({ durationMin: 30, patientBusy: elsewhere }), kenji, context)),
    ).toEqual(['15:00']);
    expect(startsFor(entry({ branchId: 'other' }), kenji, context)).toEqual([]);
  });

  it('keeps the local grid on a DST change', () => {
    // Beirut springs forward at midnight on Sunday 29 March 2026: a day without 00:00–01:00.
    const allWeek = HOURS.map((day) => ({ ...day, isOpen: true }));
    const dst = openings([freed('a', '2026-03-29', '10:00', 60)], [], {
      hours: allWeek,
      now: at('2026-03-20', '09:00'),
    })[0] as Opening;
    expect(spanOf(dst)).toBe('08:00–18:00');
    expect(
      clocks(
        startsFor(entry({ durationMin: 30, until: null }), dst, {
          ...context,
          today: '2026-03-20',
        }),
      ),
    ).toEqual(['10:00', '09:45', '10:15', '10:30', '10:45']);
  });
});

describe('the fair order (B3)', () => {
  const row = (id: string, overrides: Partial<Parameters<typeof compareFair>[0]> = {}) => ({
    id,
    urgent: false,
    triedToday: false,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  });

  it('puts urgent first, then not tried today, then the longest wait', () => {
    const rows = [
      row('tried', { triedToday: true, createdAt: new Date('2026-10-01T00:00:00Z') }),
      row('late', { createdAt: new Date('2026-11-10T00:00:00Z') }),
      row('early', { createdAt: new Date('2026-10-20T00:00:00Z') }),
      row('urgent-tried', { urgent: true, triedToday: true }),
      row('urgent', { urgent: true }),
      row('b'),
      row('a'),
    ];
    expect([...rows].sort(compareFair).map((item) => item.id)).toEqual([
      'urgent',
      'urgent-tried',
      'early',
      'a',
      'b',
      'late',
      'tried',
    ]);
  });
});
