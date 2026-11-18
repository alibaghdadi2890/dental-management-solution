import type { OpeningDay } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { capacityMinutes, openHours, openMinutes, weekdayOf } from './capacity';

/** Mon–Sat 08:00–18:00, closed on Sunday. */
const HOURS: OpeningDay[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isOpen: weekday !== 0,
  from: '08:00',
  to: '18:00',
}));

describe('capacity', () => {
  it('knows weekdays', () => {
    expect(weekdayOf('2026-11-15')).toBe(0);
    expect(weekdayOf('2026-11-18')).toBe(3);
  });

  it('counts opening minutes × rooms over the days (9–14 Nov: 120 hours)', () => {
    const days = ['09', '10', '11', '12', '13', '14'].map((day) => `2026-11-${day}`);
    expect(capacityMinutes(HOURS, 2, days)).toBe(120 * 60);
    expect(openMinutes(HOURS, '2026-11-15')).toBe(0);
    expect(capacityMinutes(HOURS, 0, days)).toBe(0);
  });

  it('lists the open hours', () => {
    expect(openHours(HOURS)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(openHours([{ weekday: 1, isOpen: true, from: '08:30', to: '10:15' }])).toEqual([
      8, 9, 10,
    ]);
  });
});
