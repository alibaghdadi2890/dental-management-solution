import { describe, expect, it } from 'vitest';
import { meanOf, medianOf, waitFigures, waitMinutes } from './figures';

const at = (time: string) => new Date(`2026-11-18T${time}:00Z`);

describe('waitMinutes', () => {
  it('counts check-in to start on the same clinic day', () => {
    expect(
      waitMinutes({
        startedAt: at('09:12'),
        localDate: '2026-11-18',
        checkedInAt: at('09:00'),
        checkedInDate: '2026-11-18',
      }),
    ).toBe(12);
  });

  it('ignores another day, a missing check-in and a start before it', () => {
    const base = { startedAt: at('09:00'), localDate: '2026-11-18' };
    expect(waitMinutes({ ...base, checkedInAt: null, checkedInDate: null })).toBeNull();
    expect(
      waitMinutes({ ...base, checkedInAt: at('08:00'), checkedInDate: '2026-11-17' }),
    ).toBeNull();
    expect(
      waitMinutes({ ...base, checkedInAt: at('09:30'), checkedInDate: '2026-11-18' }),
    ).toBeNull();
  });
});

describe('waitFigures (the acceptance: 5, 12 and 20 minutes)', () => {
  it('gives the median and how many waited over 15 minutes', () => {
    expect(waitFigures([5, 12, 20, null])).toEqual({ count: 3, medianMinutes: 12, over15: 1 });
    expect(waitFigures([])).toEqual({ count: 0, medianMinutes: null, over15: 0 });
  });

  it('averages and takes medians to the minute', () => {
    expect(medianOf([10, 13])).toBe(12);
    expect(meanOf([10, 11, 11])).toBe(11);
    expect(meanOf([])).toBeNull();
  });
});
