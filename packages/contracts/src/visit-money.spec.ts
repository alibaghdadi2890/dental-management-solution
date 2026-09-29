import { describe, expect, it } from 'vitest';
import { durationMinutes, lineFinal, visitMoney, type MoneyLine } from './visit-money.js';

describe('lineFinal', () => {
  it('is base minus discount', () => {
    expect(lineFinal({ base: '50.00', discount: '0.00' })).toBe('50.00');
    expect(lineFinal({ base: '100.00', discount: '20.00' })).toBe('80.00');
  });
});

const TWO_LINES: MoneyLine[] = [
  { base: '100', discount: '20' },
  { base: '50', discount: '0' },
];

describe('visitMoney', () => {
  it('sums line finals and applies a percent discount', () => {
    expect(visitMoney(TWO_LINES, 'percent', '10')).toEqual({
      subtotal: '130.00',
      discount: '13.00',
      total: '117.00',
      capped: false,
    });
  });

  it('rounds a percent discount half up', () => {
    const lines: MoneyLine[] = [{ base: '0.10', discount: '0' }];
    expect(visitMoney(lines, 'percent', '12.5')).toEqual({
      subtotal: '0.10',
      discount: '0.01',
      total: '0.09',
      capped: false,
    });
  });

  it('caps a percent discount above 100% and zeroes the total', () => {
    expect(visitMoney(TWO_LINES, 'percent', '150')).toEqual({
      subtotal: '130.00',
      discount: '130.00',
      total: '0.00',
      capped: true,
    });
  });

  it('is not capped at exactly 100%', () => {
    expect(visitMoney(TWO_LINES, 'percent', '100')).toEqual({
      subtotal: '130.00',
      discount: '130.00',
      total: '0.00',
      capped: false,
    });
  });

  it('applies an amount discount below the subtotal, uncapped', () => {
    expect(visitMoney(TWO_LINES, 'amount', '30')).toEqual({
      subtotal: '130.00',
      discount: '30.00',
      total: '100.00',
      capped: false,
    });
  });

  it('caps an amount discount above the subtotal', () => {
    expect(visitMoney(TWO_LINES, 'amount', '500')).toEqual({
      subtotal: '130.00',
      discount: '130.00',
      total: '0.00',
      capped: true,
    });
  });

  it('is all zero with no lines', () => {
    expect(visitMoney([], 'percent', '10')).toEqual({
      subtotal: '0.00',
      discount: '0.00',
      total: '0.00',
      capped: false,
    });
    expect(visitMoney([], 'amount', '0')).toEqual({
      subtotal: '0.00',
      discount: '0.00',
      total: '0.00',
      capped: false,
    });
  });

  it('sums correctly beyond Number.MAX_SAFE_INTEGER cents', () => {
    // 100,000,000,000,000.00 per line × 2 lines: the subtotal in cents (2×10^19) is far past
    // Number.MAX_SAFE_INTEGER (~9×10^15), so this only comes out right on bigint math.
    const hugeLines: MoneyLine[] = [
      { base: '100000000000000.00', discount: '0' },
      { base: '100000000000000.00', discount: '0' },
    ];
    expect(visitMoney(hugeLines, 'amount', '0')).toEqual({
      subtotal: '200000000000000.00',
      discount: '0.00',
      total: '200000000000000.00',
      capped: false,
    });
  });

  it('throws on a negative discount value', () => {
    expect(() => visitMoney(TWO_LINES, 'percent', '-10')).toThrow(RangeError);
    expect(() => visitMoney(TWO_LINES, 'amount', '-10')).toThrow(RangeError);
  });

  it('throws when a line discount exceeds its base', () => {
    const lines: MoneyLine[] = [{ base: '10.00', discount: '10.01' }];
    expect(() => visitMoney(lines, 'amount', '0')).toThrow(RangeError);
  });

  it('throws when a line base is negative', () => {
    const lines: MoneyLine[] = [{ base: '-10.00', discount: '0' }];
    expect(() => visitMoney(lines, 'amount', '0')).toThrow(RangeError);
  });

  it('throws on a malformed amount', () => {
    expect(() => visitMoney(TWO_LINES, 'amount', 'abc')).toThrow(RangeError);
    expect(() => visitMoney([{ base: 'abc', discount: '0' }], 'amount', '0')).toThrow(RangeError);
  });
});

describe('durationMinutes', () => {
  it('rounds up and is at least 1', () => {
    expect(durationMinutes(0)).toBe(1);
    expect(durationMinutes(1)).toBe(1);
    expect(durationMinutes(60)).toBe(1);
    expect(durationMinutes(61)).toBe(2);
    expect(durationMinutes(119)).toBe(2);
    expect(durationMinutes(120)).toBe(2);
  });
});
