import { describe, expect, it } from 'vitest';
import { fromCents, toCents } from './cents.js';

describe('toCents', () => {
  it('parses whole, one- and two-decimal amounts', () => {
    expect(toCents('30')).toBe(3000n);
    expect(toCents('30.5')).toBe(3050n);
    expect(toCents('30.50')).toBe(3050n);
    expect(toCents('0.01')).toBe(1n);
  });

  it('parses negative amounts (ledger credits/adjustments)', () => {
    expect(toCents('-30.50')).toBe(-3050n);
    expect(toCents('-0.01')).toBe(-1n);
  });

  it.each(['', 'abc', '1.234', '1e3', '-'])('throws on malformed input %j', (amount) => {
    expect(() => toCents(amount)).toThrow(RangeError);
  });
});

describe('fromCents', () => {
  it('formats to exactly 2 decimals', () => {
    expect(fromCents(3000n)).toBe('30.00');
    expect(fromCents(1n)).toBe('0.01');
    expect(fromCents(0n)).toBe('0.00');
  });

  it('formats negative amounts', () => {
    expect(fromCents(-3050n)).toBe('-30.50');
  });

  it('round-trips through toCents', () => {
    for (const amount of ['0.00', '30.00', '-30.50', '999999999999999999.99']) {
      expect(fromCents(toCents(amount))).toBe(amount);
    }
  });
});
