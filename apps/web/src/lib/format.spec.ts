import { describe, expect, it } from 'vitest';
import {
  currencySymbol,
  dateInputOrder,
  formatAgeLine,
  formatDate,
  formatDateTime,
  formatMoney,
  todayIn,
} from './format';

describe('formatDate', () => {
  it('uses the POC display format in English', () => {
    expect(formatDate('2026-09-04T10:00:00Z', { timeZone: 'UTC', locale: 'en' })).toBe(
      '4 Sep 2026',
    );
  });

  it('uses the tenant timezone, not the browser one', () => {
    // 23:30 UTC on the 4th is already the 5th in Baghdad (UTC+3).
    expect(formatDate('2026-09-04T23:30:00Z', { timeZone: 'Asia/Baghdad', locale: 'en' })).toBe(
      '5 Sep 2026',
    );
  });

  it('follows the locale for other languages', () => {
    expect(formatDate('2026-09-04T10:00:00Z', { timeZone: 'UTC', locale: 'fr' })).toBe(
      '4 sept. 2026',
    );
  });
});

describe('formatDateTime', () => {
  it('adds a 24-hour time in the tenant timezone', () => {
    expect(formatDateTime('2026-09-04T06:05:00Z', { timeZone: 'Asia/Baghdad', locale: 'en' })).toBe(
      '4 Sep 2026, 09:05',
    );
  });
});

describe('formatMoney', () => {
  it('drops decimals for whole amounts', () => {
    expect(formatMoney({ amount: '1234.00', currency: 'USD' }, 'en')).toBe('$1,234');
  });

  it('keeps cents when present', () => {
    expect(formatMoney({ amount: '1234.5', currency: 'USD' }, 'en')).toBe('$1,234.50');
  });

  it('shows refunds with a true minus sign', () => {
    expect(formatMoney({ amount: '-30', currency: 'USD' }, 'en')).toBe('−$30');
  });
});

describe('currencySymbol', () => {
  it('gives the narrow symbol for price inputs', () => {
    expect(currencySymbol('USD', 'en')).toBe('$');
    expect(currencySymbol('EUR', 'fr')).toBe('€');
  });
});

describe('todayIn', () => {
  it('uses the tenant timezone, not UTC', () => {
    // 22:30 UTC on the 27th is already 01:30 on the 28th in Beirut (UTC+3 in September).
    expect(todayIn('Asia/Beirut', new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-28');
  });

  it('matches UTC when the timezone is UTC', () => {
    expect(todayIn('UTC', new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-27');
  });
});

describe('formatAgeLine', () => {
  const options = { timeZone: 'UTC', locale: 'en' };

  it('is unknown with no date of birth', () => {
    expect(formatAgeLine(null, '2026-09-27', options)).toEqual({ kind: 'unknown' });
  });

  it('gives the whole-years age and the formatted date of birth', () => {
    expect(formatAgeLine('2019-01-15', '2026-09-27', options)).toEqual({
      kind: 'full',
      age: 7,
      dob: '15 Jan 2019',
    });
  });

  it('shows only the date when it is somehow after today', () => {
    expect(formatAgeLine('2027-01-01', '2026-09-27', options)).toEqual({
      kind: 'dobOnly',
      dob: '1 Jan 2027',
    });
  });
});

describe('dateInputOrder', () => {
  it('is DMY for en-LB', () => {
    expect(dateInputOrder('en', 'LB')).toBe('DMY');
  });

  it('is MDY for en-US', () => {
    expect(dateInputOrder('en', 'US')).toBe('MDY');
  });
});
