import { describe, expect, it } from 'vitest';
import { rankByBalance, sumBalances } from './balances';

const usd = (amount: string) => ({ amount, currency: 'USD' });
const eur = (amount: string) => ({ amount, currency: 'EUR' });

describe('sumBalances', () => {
  it('sums exactly, without floating-point drift', () => {
    expect(sumBalances([usd('10.10'), usd('-0.10')])).toEqual([usd('10.00')]);
    expect(sumBalances([usd('0.10'), usd('0.20')])).toEqual([usd('0.30')]);
    expect(sumBalances([usd('9999999999.99'), usd('0.01')])).toEqual([usd('10000000000.00')]);
  });

  it('accepts amounts with fewer than two decimals', () => {
    expect(sumBalances([usd('10'), usd('0.5')])).toEqual([usd('10.50')]);
  });

  it('formats negative results and sub-unit amounts', () => {
    expect(sumBalances([usd('-5')])).toEqual([usd('-5.00')]);
    expect(sumBalances([usd('-0.05')])).toEqual([usd('-0.05')]);
    expect(sumBalances([usd('0.05'), usd('-1.10')])).toEqual([usd('-1.05')]);
  });

  it('groups by currency, ordered by currency code', () => {
    expect(sumBalances([usd('250.00'), eur('10.00'), usd('-50.00'), eur('5.25')])).toEqual([
      eur('15.25'),
      usd('200.00'),
    ]);
  });

  it('drops a currency whose sum is zero', () => {
    expect(sumBalances([usd('10.00'), eur('3.00'), usd('-10.00')])).toEqual([eur('3.00')]);
    expect(sumBalances([usd('-0.00')])).toEqual([]);
  });

  it('returns [] for no entries', () => {
    expect(sumBalances([])).toEqual([]);
  });

  it('refuses a malformed amount instead of guessing', () => {
    expect(() => sumBalances([usd('1.234')])).toThrow(RangeError);
    expect(() => sumBalances([usd('1e3')])).toThrow(RangeError);
    expect(() => sumBalances([usd('')])).toThrow(RangeError);
  });
});

describe('rankByBalance', () => {
  // Input order = name order (the caller's tie-break).
  const patients = [
    { patientId: 'ada', balances: [usd('100.00')] },
    { patientId: 'ben', balances: [usd('-20.00')] },
    { patientId: 'cam', balances: [] },
    { patientId: 'dia', balances: [usd('250.00')] },
    { patientId: 'eli', balances: [usd('-50.00')] },
    // Owes only in another currency: counts as zero in the tenant currency.
    { patientId: 'fay', balances: [eur('500.00')] },
    { patientId: 'gus', balances: [usd('100.00'), eur('-7.00')] },
    { patientId: 'hal', balances: [usd('-20.00')] },
  ];

  it('desc: largest debts first, everyone else at restAt, then credits least negative first', () => {
    expect(rankByBalance(patients, 'desc', 'USD')).toEqual({
      ids: ['dia', 'ada', 'gus', 'ben', 'hal', 'eli'],
      restAt: 3,
    });
  });

  it('asc: largest credits first, everyone else at restAt, then debts smallest first', () => {
    expect(rankByBalance(patients, 'asc', 'USD')).toEqual({
      ids: ['eli', 'ben', 'hal', 'ada', 'gus', 'dia'],
      restAt: 3,
    });
  });

  it('ranks by the tenant currency only', () => {
    expect(rankByBalance(patients, 'desc', 'EUR')).toEqual({ ids: ['fay', 'gus'], restAt: 1 });
  });

  it('keeps input order for ties in both directions', () => {
    const tied = [
      { patientId: 'b', balances: [usd('5.00')] },
      { patientId: 'a', balances: [usd('5.00')] },
      { patientId: 'd', balances: [usd('-5.00')] },
      { patientId: 'c', balances: [usd('-5.00')] },
    ];
    expect(rankByBalance(tied, 'desc', 'USD').ids).toEqual(['b', 'a', 'd', 'c']);
    expect(rankByBalance(tied, 'asc', 'USD').ids).toEqual(['d', 'c', 'b', 'a']);
  });

  it('puts the rest first or last when one side is empty', () => {
    const debts = [
      { patientId: 'a', balances: [usd('1.00')] },
      { patientId: 'b', balances: [] },
    ];
    expect(rankByBalance(debts, 'desc', 'USD')).toEqual({ ids: ['a'], restAt: 1 });
    expect(rankByBalance(debts, 'asc', 'USD')).toEqual({ ids: ['a'], restAt: 0 });
  });

  it('ranks nobody when every balance is zero', () => {
    expect(rankByBalance([{ patientId: 'a', balances: [] }], 'desc', 'USD')).toEqual({
      ids: [],
      restAt: 0,
    });
    expect(rankByBalance([], 'asc', 'USD')).toEqual({ ids: [], restAt: 0 });
  });
});
