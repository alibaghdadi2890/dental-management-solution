import { describe, expect, it } from 'vitest';
import { sanitizeAmountInput } from './amount';

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
});
