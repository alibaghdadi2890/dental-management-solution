import { describe, expect, it } from 'vitest';
import { ageBandBounds, ageOn, dentitionStage, isMinor } from './patient-age.js';

describe('ageOn', () => {
  it('turns a year older the day before and on the birthday', () => {
    expect(ageOn('2020-09-27', '2026-09-26')).toBe(5);
    expect(ageOn('2020-09-27', '2026-09-27')).toBe(6);
    expect(ageOn('2013-09-27', '2026-09-26')).toBe(12);
    expect(ageOn('2013-09-27', '2026-09-27')).toBe(13);
  });

  it('turns a Feb-29 birthday a year older on Mar 1 in a non-leap year', () => {
    expect(ageOn('2012-02-29', '2027-02-28')).toBe(14);
    expect(ageOn('2012-02-29', '2027-03-01')).toBe(15);
    expect(ageOn('2012-02-29', '2028-02-29')).toBe(16);
  });

  it('computes exactly 18 and 65 for leap-day birthdays against a non-leap "today"', () => {
    // 2008 is a leap year; 2026 (18 years later) is not.
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
    // 1960 is a leap year; 2025 (65 years later) is not.
    expect(ageOn('1960-02-29', '2025-02-28')).toBe(64);
    expect(ageOn('1960-02-29', '2025-03-01')).toBe(65);
  });
});

describe('dentitionStage', () => {
  it('maps age to primary/mixed/permanent at the 5/6 and 12/13 boundaries', () => {
    expect(dentitionStage(5)).toBe('primary');
    expect(dentitionStage(6)).toBe('mixed');
    expect(dentitionStage(12)).toBe('mixed');
    expect(dentitionStage(13)).toBe('permanent');
  });
});

describe('isMinor', () => {
  it('is true the day before 18 and false exactly at 18', () => {
    expect(isMinor('2008-09-28', '2026-09-27')).toBe(true);
    expect(isMinor('2008-09-27', '2026-09-27')).toBe(false);
  });
});

describe('ageBandBounds', () => {
  it('places a Feb-29 "today" boundary on Feb 28 of the non-leap threshold year', () => {
    const bounds = ageBandBounds('child', '2028-02-29');
    expect(bounds.after).toBe('2010-02-28');
  });
});
