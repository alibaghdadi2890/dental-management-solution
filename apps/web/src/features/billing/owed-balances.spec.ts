import { describe, expect, it } from 'vitest';
import { owedBalances } from './owed-balances';

const usd = (amount: string) => ({ amount, currency: 'USD' });
const eur = (amount: string) => ({ amount, currency: 'EUR' });

describe('owedBalances', () => {
  it('lists every non-zero balance, the tenant currency first', () => {
    expect(owedBalances([eur('40.00'), usd('-5.00')], 'USD')).toEqual([usd('-5.00'), eur('40.00')]);
  });

  it('does not let a zero tenant balance hide another currency', () => {
    expect(owedBalances([usd('0.00'), eur('40.00')], 'USD')).toEqual([eur('40.00')]);
  });

  it('is empty when nothing is owed or credited', () => {
    expect(owedBalances([usd('0.00')], 'USD')).toEqual([]);
    expect(owedBalances([], 'USD')).toEqual([]);
  });
});
