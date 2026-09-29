import { describe, expect, it } from 'vitest';
import { durationMinutes, lineFinal, visitMoney, type MoneyLine } from './visit-money.js';

describe('lineFinal', () => {
  it('is base minus discount', () => {
    expect(lineFinal({ base: '50.00', discount: '0.00' })).toBe('50.00');
    expect(lineFinal({ base: '100.00', discount: '20.00' })).toBe('80.00');
  });
});

describe('visitMoney', () => {
  it('sums line finals and applies a percent discount', () => {
    const lines: MoneyLine[] = [
      { base: '100', discount: '20' },
      { base: '50', discount: '0' },
    ];
    expect(visitMoney(lines, 'percent', '10')).toEqual({
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
    const lines: MoneyLine[] = [
      { base: '100', discount: '20' },
      { base: '50', discount: '0' },
    ];
    expect(visitMoney(lines, 'percent', '150')).toEqual({
      subtotal: '130.00',
      discount: '130.00',
      total: '0.00',
      capped: true,
    });
  });

  it('caps an amount discount above the subtotal', () => {
    const lines: MoneyLine[] = [
      { base: '100', discount: '20' },
      { base: '50', discount: '0' },
    ];
    expect(visitMoney(lines, 'amount', '500')).toEqual({
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

  it('never discounts below zero, even under a large amount value', () => {
    const result = visitMoney([{ base: '10', discount: '0' }], 'amount', '25');
    expect(Number(result.total)).toBeGreaterThanOrEqual(0);
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
