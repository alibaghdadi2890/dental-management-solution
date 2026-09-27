import { describe, expect, it } from 'vitest';
import { localDate } from './local-date';

describe('localDate', () => {
  it('is the UTC date when the zone is UTC', () => {
    expect(localDate(new Date('2026-03-01T23:30:00Z'), 'UTC')).toBe('2026-03-01');
  });

  it('is already tomorrow east of UTC late in the UTC day', () => {
    // Beirut is UTC+2 in winter: 23:30 UTC is 01:30 the next day.
    expect(localDate(new Date('2026-03-01T23:30:00Z'), 'Asia/Beirut')).toBe('2026-03-02');
  });

  it('is still yesterday west of UTC early in the UTC day', () => {
    expect(localDate(new Date('2026-03-02T03:00:00Z'), 'America/New_York')).toBe('2026-03-01');
  });

  it('follows daylight saving time', () => {
    // Beirut is UTC+3 in summer: 21:30 UTC is 00:30 the next day (UTC+2 would still be 23:30).
    expect(localDate(new Date('2026-07-01T21:30:00Z'), 'Asia/Beirut')).toBe('2026-07-02');
  });

  it('crosses a year boundary', () => {
    expect(localDate(new Date('2026-12-31T22:30:00Z'), 'Asia/Baghdad')).toBe('2027-01-01');
  });
});
