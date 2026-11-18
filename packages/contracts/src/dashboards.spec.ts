import { describe, expect, it } from 'vitest';
import {
  amountRatio,
  changeOf,
  isWholeMonths,
  monthsEnding,
  ratio,
  resolvePeriod,
  weeksEnding,
  weekStartOf,
  wholeMonthsOf,
} from './dashboards.js';

const resolve = (period: Parameters<typeof resolvePeriod>[0]['period'], today: string) =>
  resolvePeriod({ period }, today);

describe('resolvePeriod (ADR-0089)', () => {
  it('compares a running month with the same days of last month', () => {
    const period = resolve('this_month', '2026-11-18');
    expect(period).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-18',
      compare: { from: '2026-10-01', to: '2026-10-18' },
    });
  });

  it('clamps the same days to a shorter month', () => {
    expect(resolve('this_month', '2026-03-31')?.compare).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(resolve('this_month', '2026-01-01')?.compare).toEqual({
      from: '2025-12-01',
      to: '2025-12-01',
    });
  });

  it('takes whole months for the last month, 3 and 12 months, and compares the months before', () => {
    expect(resolve('last_month', '2026-11-18')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      compare: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(resolve('last_3_months', '2026-01-05')).toMatchObject({
      from: '2025-10-01',
      to: '2025-12-31',
      compare: { from: '2025-07-01', to: '2025-09-30' },
    });
    expect(resolve('last_12_months', '2026-11-18')).toMatchObject({
      from: '2025-11-01',
      to: '2026-10-31',
      compare: { from: '2024-11-01', to: '2025-10-31' },
    });
  });

  it('compares this year with the same days of last year, 29 Feb with 28 Feb', () => {
    expect(resolve('this_year', '2026-11-18')).toMatchObject({
      from: '2026-01-01',
      to: '2026-11-18',
      compare: { from: '2025-01-01', to: '2025-11-18' },
    });
    expect(resolve('this_year', '2028-02-29')?.compare.to).toBe('2027-02-28');
  });

  it('compares a custom span with as many days before, or as many whole months', () => {
    expect(
      resolvePeriod({ period: 'custom', from: '2026-11-09', to: '2026-11-14' }, '2026-11-18'),
    ).toMatchObject({ compare: { from: '2026-11-03', to: '2026-11-08' } });
    expect(
      resolvePeriod({ period: 'custom', from: '2026-08-01', to: '2026-09-30' }, '2026-11-18'),
    ).toMatchObject({ compare: { from: '2026-06-01', to: '2026-07-31' } });
  });

  it('refuses a custom span that is reversed, open, in the future or over 24 months', () => {
    const today = '2026-11-18';
    expect(resolvePeriod({ period: 'custom', from: '2026-11-10' }, today)).toBeNull();
    expect(
      resolvePeriod({ period: 'custom', from: '2026-11-10', to: '2026-11-01' }, today),
    ).toBeNull();
    expect(
      resolvePeriod({ period: 'custom', from: '2026-11-10', to: '2026-11-19' }, today),
    ).toBeNull();
    expect(
      resolvePeriod({ period: 'custom', from: '2024-12-01', to: '2026-11-18' }, today),
    ).not.toBeNull();
    expect(
      resolvePeriod({ period: 'custom', from: '2024-11-30', to: '2026-11-18' }, today),
    ).toBeNull();
  });

  it('ends the trends with the period: 12 months and 12 Monday-weeks', () => {
    const period = resolve('last_month', '2026-11-18');
    expect(period?.months).toHaveLength(12);
    expect(period?.months[0]).toBe('2025-11');
    expect(period?.months.at(-1)).toBe('2026-10');
    expect(period?.weeks.at(-1)).toBe('2026-10-26');
    expect(period?.weeks[0]).toBe('2026-08-10');
  });
});

describe('calendar helpers', () => {
  it('finds the Monday of a week, Sunday included', () => {
    expect(weekStartOf('2026-11-18')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16');
  });

  it('crosses years in month and week windows', () => {
    expect(monthsEnding('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(weeksEnding('2026-01-02', 2)).toEqual(['2025-12-22', '2025-12-29']);
  });

  it('knows whole months', () => {
    expect(isWholeMonths({ from: '2026-10-01', to: '2026-11-30' })).toBe(true);
    expect(isWholeMonths({ from: '2026-11-01', to: '2026-11-18' })).toBe(false);
    expect(wholeMonthsOf({ from: '2025-12-01', to: '2026-01-31' })).toEqual(['2025-12', '2026-01']);
    expect(wholeMonthsOf({ from: '2025-12-02', to: '2026-01-31' })).toEqual([]);
  });
});

describe('rates with a zero denominator', () => {
  it('is null, never 0 or NaN', () => {
    expect(ratio(3, 0)).toBeNull();
    expect(ratio(0n, 0n)).toBeNull();
    expect(amountRatio('10.00', '0.00')).toBeNull();
    expect(changeOf(10, 0)).toBeNull();
    expect(changeOf(null, 4)).toBeNull();
  });

  it('computes from exact amounts', () => {
    expect(amountRatio('5000.00', '4300.00')).toBeCloseTo(1.162791, 5);
    expect(ratio(2n, 20n)).toBe(0.1);
    expect(changeOf(4300, 2150)).toBe(1);
    expect(changeOf(-50, 100)).toBe(-1.5);
  });
});
