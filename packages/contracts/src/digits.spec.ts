import { describe, expect, it } from 'vitest';
import { toAsciiDigits } from './digits.js';

describe('toAsciiDigits', () => {
  it('maps Arabic-Indic and Extended Arabic-Indic (Persian) digits to ASCII', () => {
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('leaves everything else alone', () => {
    expect(toAsciiDigits('P-٠١٢ Rana 03٫5')).toBe('P-012 Rana 03٫5');
  });
});
