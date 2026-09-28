import { describe, expect, it } from 'vitest';
import {
  ageOrNull,
  currencySymbol,
  dateInputOrder,
  type DateFormatOptions,
  formatAgeLine,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
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

describe('formatCalendarDate', () => {
  it('never shifts a date-only value across a timezone boundary', () => {
    // A naive `formatDate(iso, { timeZone: 'America/New_York', locale: 'en' })` would read this
    // UTC-midnight instant back as 31 Dec 1999 in New York (UTC-5) — a calendar date has no
    // instant to convert, so this must always read the literal calendar date back.
    expect(formatCalendarDate('2000-01-01', 'en')).toBe('1 Jan 2000');
  });
});

describe('ageOrNull', () => {
  it('is the whole years on today, counting the birthday itself', () => {
    expect(ageOrNull('1990-05-01', '2026-04-30')).toBe(35);
    expect(ageOrNull('1990-05-01', '2026-05-01')).toBe(36);
  });

  it('is null without a date of birth, or for one after today', () => {
    expect(ageOrNull(null, '2026-05-01')).toBeNull();
    expect(ageOrNull('2026-05-02', '2026-05-01')).toBeNull();
  });
});

describe('formatAgeLine', () => {
  it('is unknown with no date of birth', () => {
    expect(formatAgeLine(null, '2026-09-27', { locale: 'en' })).toEqual({ kind: 'unknown' });
  });

  it('gives the whole-years age and the formatted date of birth', () => {
    expect(formatAgeLine('2019-01-15', '2026-09-27', { locale: 'en' })).toEqual({
      kind: 'full',
      age: 7,
      dob: '15 Jan 2019',
    });
  });

  it('shows only the date when it is somehow after today', () => {
    expect(formatAgeLine('2027-01-01', '2026-09-27', { locale: 'en' })).toEqual({
      kind: 'dobOnly',
      dob: '1 Jan 2027',
    });
  });

  it('does not shift the date of birth when the tenant timezone is passed alongside locale', () => {
    // formatAgeLine only needs `locale`, but callers may still pass a full DateFormatOptions
    // (with a `timeZone`) — that timezone must never leak into the (timezone-less) dob format.
    const tenantOptions: DateFormatOptions = { timeZone: 'America/New_York', locale: 'en' };
    expect(formatAgeLine('2000-01-01', '2026-09-27', tenantOptions)).toEqual({
      kind: 'full',
      age: 26,
      dob: '1 Jan 2000',
    });
  });
});

describe('formatPhone', () => {
  it('formats a stored E.164 number for the tenant', () => {
    expect(formatPhone('+9613123456', 'LB')).toBe('03 123 456');
  });
});

describe('dateInputOrder', () => {
  it('is DMY for Lebanon (the platform default)', () => {
    expect(dateInputOrder('LB')).toBe('DMY');
  });

  it('is MDY for the tabled MDY countries', () => {
    expect(dateInputOrder('US')).toBe('MDY');
    expect(dateInputOrder('PH')).toBe('MDY');
  });

  it('is YMD for the tabled YMD countries', () => {
    expect(dateInputOrder('JP')).toBe('YMD');
    expect(dateInputOrder('CN')).toBe('YMD');
  });

  it('is case-insensitive', () => {
    expect(dateInputOrder('us')).toBe('MDY');
  });
});
