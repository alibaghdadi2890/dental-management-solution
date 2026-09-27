import { describe, expect, it } from 'vitest';
import { formatDisplayNumber } from './display-number';

describe('formatDisplayNumber', () => {
  it('zero-pads to 6 digits', () => {
    expect(formatDisplayNumber(1)).toBe('P-000001');
  });

  it('pads a two-digit counter', () => {
    expect(formatDisplayNumber(42)).toBe('P-000042');
  });

  it('does not pad at exactly 6 digits', () => {
    expect(formatDisplayNumber(999999)).toBe('P-999999');
  });

  it('grows past 6 digits without truncation', () => {
    expect(formatDisplayNumber(1234567)).toBe('P-1234567');
  });
});
