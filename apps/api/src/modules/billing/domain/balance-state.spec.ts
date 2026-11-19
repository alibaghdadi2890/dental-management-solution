import { describe, expect, it } from 'vitest';
import { balanceStateOf } from './balance-state';

describe('balanceStateOf', () => {
  it('owes when any currency owes, even beside a credit', () => {
    expect(balanceStateOf(['12.50'])).toBe('owes');
    expect(balanceStateOf(['-5.00', '0.01'])).toBe('owes');
  });

  it('is in credit with only credits', () => {
    expect(balanceStateOf(['-0.50', '0.00'])).toBe('credit');
  });

  it('is settled with nothing, or only zeros', () => {
    expect(balanceStateOf([])).toBe('settled');
    expect(balanceStateOf(['0.00', '-0.00'])).toBe('settled');
  });
});
