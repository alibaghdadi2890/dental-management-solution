import { describe, expect, it } from 'vitest';
import { priceOf } from './service-price';

describe('priceOf', () => {
  it('sends the typed amounts and computes the final price', () => {
    expect(priceOf({ base: '120.5', discount: '20' })).toEqual({
      patch: { baseAmount: '120.5', discountAmount: '20' },
      final: '100.50',
    });
  });

  it('reads a blank or bare-dot field as 0 and drops a trailing dot', () => {
    expect(priceOf({ base: '80.', discount: '' }).patch).toEqual({
      baseAmount: '80',
      discountAmount: '0',
    });
    expect(priceOf({ base: '.', discount: '.5' }).patch).toEqual({
      baseAmount: '0',
      discountAmount: '0',
    });
    expect(priceOf({ base: '007', discount: '0.25' }).patch.baseAmount).toBe('7');
  });

  it('caps the discount at the base', () => {
    expect(priceOf({ base: '50', discount: '75' })).toEqual({
      patch: { baseAmount: '50', discountAmount: '50' },
      final: '0.00',
    });
  });
});
