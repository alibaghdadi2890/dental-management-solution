import { describe, expect, it } from 'vitest';
import { discountDraftOf, discountInputOf, plainAmount } from './visit-discount';
import { visit } from './workspace.test-utils';

describe('plainAmount', () => {
  it('drops trailing zeros and a bare dot', () => {
    expect(plainAmount('10.00')).toBe('10');
    expect(plainAmount('12.50')).toBe('12.5');
    expect(plainAmount('0.00')).toBe('0');
    expect(plainAmount('0.05')).toBe('0.05');
    expect(plainAmount('100')).toBe('100');
  });
});

describe('the discount draft', () => {
  it('reads the stored mode and raw value', () => {
    expect(discountDraftOf(visit({ discountMode: 'amount', discountValue: '500.00' }))).toEqual({
      mode: 'amount',
      value: '500',
    });
  });

  it('saves the raw value, never capped; blank or a bare dot is 0', () => {
    expect(discountInputOf({ mode: 'percent', value: '500' })).toEqual({
      mode: 'percent',
      value: '500',
    });
    expect(discountInputOf({ mode: 'amount', value: '' })).toEqual({ mode: 'amount', value: '0' });
    expect(discountInputOf({ mode: 'amount', value: '12.' })).toEqual({
      mode: 'amount',
      value: '12',
    });
  });
});
