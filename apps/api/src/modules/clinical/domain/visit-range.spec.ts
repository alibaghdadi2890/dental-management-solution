import { describe, expect, it } from 'vitest';
import { addDays, rangeStart } from './visit-range';

describe('rangeStart', () => {
  it.each([
    ['today', '2026-10-01'],
    ['7d', '2026-09-25'],
    ['30d', '2026-09-02'],
    ['90d', '2026-07-04'],
    ['12m', '2025-10-02'],
  ] as const)('%s starts on %s', (range, start) => {
    expect(rangeStart(range, '2026-10-01')).toBe(start);
  });

  it('is unbounded for all', () => {
    expect(rangeStart('all', '2026-10-01')).toBeNull();
  });
});

describe('addDays', () => {
  it('crosses months, years and leap days', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
