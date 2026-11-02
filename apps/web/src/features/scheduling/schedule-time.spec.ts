import type { OpeningDay } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  clinicClock,
  dentistColor,
  gridBounds,
  instantOf,
  isClosedAt,
  mondayOf,
  weekOf,
} from './schedule-time';

const BEIRUT = 'Asia/Beirut';
const HOURS: OpeningDay[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isOpen: weekday !== 0,
  from: weekday === 6 ? '08:00' : '09:00',
  to: weekday === 6 ? '13:00' : '18:00',
}));
const THURSDAY = '2026-10-29';
const SUNDAY = '2026-10-25';
const iso = (time: string, date = THURSDAY) => instantOf(date, time, BEIRUT).toISOString();

describe('days', () => {
  it('walks across month ends and finds the Monday', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(mondayOf(THURSDAY)).toBe('2026-10-26');
    expect(mondayOf(SUNDAY)).toBe('2026-10-19');
    expect(weekOf(THURSDAY).at(-1)).toBe('2026-11-01');
  });

  it('reads an instant back on the clinic clock', () => {
    expect(clinicClock(iso('14:45'), BEIRUT)).toEqual({ date: THURSDAY, time: '14:45' });
  });
});

describe('gridBounds', () => {
  it('runs from the earliest opening to the latest closing of the visible days', () => {
    expect(gridBounds(weekOf(THURSDAY), HOURS, [], BEIRUT)).toEqual({ from: 8 * 60, to: 18 * 60 });
    expect(gridBounds(['2026-10-31'], HOURS, [], BEIRUT)).toEqual({ from: 8 * 60, to: 13 * 60 });
  });

  it('widens to hold an appointment outside the hours (G17)', () => {
    const late = { startsAt: iso('18:30'), endsAt: iso('19:15') };
    expect(gridBounds([THURSDAY], HOURS, [late], BEIRUT)).toEqual({ from: 9 * 60, to: 20 * 60 });
  });

  it('falls back on a closed day with nothing booked', () => {
    expect(gridBounds([SUNDAY], HOURS, [], BEIRUT)).toEqual({ from: 8 * 60, to: 18 * 60 });
  });
});

describe('isClosedAt', () => {
  it('knows closed days and the edges of the hours', () => {
    expect(isClosedAt(SUNDAY, 600, HOURS)).toBe(true);
    expect(isClosedAt(THURSDAY, 9 * 60, HOURS)).toBe(false);
    expect(isClosedAt(THURSDAY, 18 * 60, HOURS)).toBe(true);
    expect(isClosedAt(THURSDAY, 8 * 60 + 45, HOURS)).toBe(true);
  });
});

describe('dentistColor', () => {
  it('is stable and cycles', () => {
    expect(dentistColor(0)).toBe('blue');
    expect(dentistColor(1)).not.toBe(dentistColor(0));
    expect(dentistColor(8)).toBe(dentistColor(0));
  });
});
