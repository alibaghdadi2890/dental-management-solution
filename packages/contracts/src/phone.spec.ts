import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone, phoneDigits, SUPPORTED_COUNTRIES } from './phone.js';

describe('normalizePhone', () => {
  it('parses a Lebanese local number with a trunk prefix', () => {
    expect(normalizePhone('03 123 456', 'LB')).toEqual({
      e164: '+9613123456',
      national: '03123456',
    });
  });

  it('parses the same number without the trunk prefix identically', () => {
    expect(normalizePhone('3123456', 'LB')).toEqual({ e164: '+9613123456', national: '03123456' });
  });

  it('honours a leading + for a different country than the tenant', () => {
    expect(normalizePhone('+33 6 12 34 56 78', 'LB')).toEqual({
      e164: '+33612345678',
      national: '0612345678',
    });
  });

  it('returns null for numbers that are too short or not numbers at all', () => {
    expect(normalizePhone('12', 'LB')).toBeNull();
    expect(normalizePhone('abc', 'LB')).toBeNull();
  });

  it('returns null for a number typed with an extension', () => {
    expect(normalizePhone('03 123 456 ext. 12', 'LB')).toBeNull();
  });

  it('rejects a number that is not valid under the full metadata build (LB)', () => {
    expect(normalizePhone('07682462', 'LB')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('formats a stored E.164 number for display', () => {
    expect(formatPhone('+9613123456')).toBe('+961 3 123 456');
  });

  it('returns the input unchanged when it cannot be parsed as a phone number at all', () => {
    expect(formatPhone('not-a-phone')).toBe('not-a-phone');
  });
});

describe('phoneDigits', () => {
  it('strips everything but digits', () => {
    expect(phoneDigits(' (03) 12-3 ')).toBe('03123');
  });
});

describe('SUPPORTED_COUNTRIES', () => {
  it('lists every dialling country as upper-case ISO alpha-2, LB included, with no duplicates', () => {
    expect(SUPPORTED_COUNTRIES.length).toBeGreaterThan(100);
    expect(SUPPORTED_COUNTRIES).toContain('LB');
    for (const code of SUPPORTED_COUNTRIES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
    expect(new Set(SUPPORTED_COUNTRIES).size).toBe(SUPPORTED_COUNTRIES.length);
  });
});
