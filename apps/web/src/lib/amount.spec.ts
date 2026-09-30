import { describe, expect, it } from 'vitest';
import { parseAmount, sanitizeAmountInput } from './amount';

describe('sanitizeAmountInput', () => {
  it('strips currency symbols and thousands separators (en)', () => {
    expect(sanitizeAmountInput('$1,250.505', 'en')).toBe('1250.50');
  });

  it('reads a French comma as the decimal separator', () => {
    expect(sanitizeAmountInput('12,50', 'fr')).toBe('12.50');
  });

  it('strips a French space thousands separator alongside the comma decimal', () => {
    expect(sanitizeAmountInput('1 234,5', 'fr')).toBe('1234.5');
  });

  it('maps Arabic-Indic digits and the Arabic decimal separator to ASCII', () => {
    expect(sanitizeAmountInput('١٢٫٥', 'ar')).toBe('12.5');
  });

  it('drops non-numeric input entirely', () => {
    expect(sanitizeAmountInput('abc', 'en')).toBe('');
  });

  it('keeps a bare trailing dot as typed (caller decides whether to strip it)', () => {
    expect(sanitizeAmountInput('3.', 'en')).toBe('3.');
  });

  it('collapses repeated dots into the decimal part', () => {
    expect(sanitizeAmountInput('1.2.3', 'en')).toBe('1.23');
  });

  it('keeps at most 10 whole digits, the most a stored amount holds (numeric(12,2))', () => {
    expect(sanitizeAmountInput('123456789012', 'en')).toBe('1234567890');
    expect(sanitizeAmountInput('123456789012.55', 'en')).toBe('1234567890.55');
  });
});

describe('parseAmount', () => {
  it('reads plain and grouped amounts in the locale', () => {
    expect(parseAmount('250', 'en')).toBe('250');
    expect(parseAmount('1,250.50', 'en')).toBe('1250.50');
    expect(parseAmount('12,50', 'fr')).toBe('12.50');
    expect(parseAmount('1 234,5', 'fr')).toBe('1234.5');
    expect(parseAmount('12.50', 'fr')).toBe('12.50');
    expect(parseAmount('١٢٫٥', 'ar')).toBe('12.5');
  });

  it('reads ASCII `,` groups and a `.` decimal in Arabic, whatever digits the locale uses', () => {
    expect(parseAmount('1,234.50', 'ar')).toBe('1234.50');
    expect(parseAmount('1,234.50', 'ar-EG')).toBe('1234.50');
    expect(parseAmount('١٬٢٣٤٫٥٠', 'ar-EG')).toBe('1234.50');
    expect(parseAmount('12,50', 'ar-EG')).toBeNull();
  });

  it('tidies a leading or trailing decimal separator', () => {
    expect(parseAmount('.5', 'en')).toBe('0.5');
    expect(parseAmount('5.', 'en')).toBe('5');
  });

  it('is blank for blank input', () => {
    expect(parseAmount('  ', 'en')).toBe('');
  });

  it('refuses anything that is not a clean number instead of stripping it', () => {
    expect(parseAmount('12.505', 'en')).toBeNull();
    expect(parseAmount('12abc', 'en')).toBeNull();
    expect(parseAmount('$12', 'en')).toBeNull();
    expect(parseAmount('1.2.3', 'en')).toBeNull();
    expect(parseAmount('12,50', 'en')).toBeNull();
    expect(parseAmount('.', 'en')).toBeNull();
  });
});
