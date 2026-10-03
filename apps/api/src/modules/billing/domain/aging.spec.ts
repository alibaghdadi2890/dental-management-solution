import { describe, expect, it } from 'vitest';
import { agingBucket, agingTotals, daysSince } from './aging';

const TODAY = '2026-10-02';

describe('aging (B10)', () => {
  it('counts whole days, never negative', () => {
    expect(daysSince('2026-10-02', TODAY)).toBe(0);
    expect(daysSince('2026-09-02', TODAY)).toBe(30);
    expect(daysSince('2026-10-05', TODAY)).toBe(0);
    // Across the March DST change, still whole days.
    expect(daysSince('2026-03-20', '2026-04-05')).toBe(16);
  });

  it.each([
    ['2026-09-02', 'd0_30'],
    ['2026-09-01', 'd31_60'],
    ['2026-08-03', 'd31_60'],
    ['2026-08-02', 'd61_90'],
    ['2026-07-04', 'd61_90'],
    ['2026-07-03', 'd90_plus'],
  ] as const)('%s is in %s', (date, bucket) => {
    expect(agingBucket(date, TODAY)).toBe(bucket);
  });

  it('sums remainders per bucket and counts each patient once, by their oldest remainder', () => {
    expect(
      agingTotals(
        [
          { patientId: 'a', date: '2026-09-30', amount: 100n },
          { patientId: 'a', date: '2026-09-20', amount: 50n },
          { patientId: 'b', date: '2026-09-30', amount: 25n },
          { patientId: 'b', date: '2026-01-01', amount: 900n },
          { patientId: 'c', date: '2026-01-01', amount: 0n },
        ],
        TODAY,
      ),
    ).toEqual([
      { bucket: 'd0_30', amount: 175n, patients: 1 },
      { bucket: 'd31_60', amount: 0n, patients: 0 },
      { bucket: 'd61_90', amount: 0n, patients: 0 },
      { bucket: 'd90_plus', amount: 900n, patients: 1 },
    ]);
  });
});
