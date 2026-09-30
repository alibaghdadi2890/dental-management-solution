import { describe, expect, it } from 'vitest';
import { patientBalance, rankByBalance, sumBalances } from './balances';

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

describe('patientBalance', () => {
  const sums = (currency: string, amount: string, charged: string) => ({
    currency,
    amount,
    charged,
  });

  it('sums the balances and the visit charges per currency, dropping zeros', () => {
    expect(
      patientBalance('p1', [sums('USD', '157.00', '117.00'), sums('EUR', '0.00', '20.00')]),
    ).toEqual({
      patientId: 'p1',
      balances: [usd('157.00')],
      charged: [eur('20.00'), usd('117.00')],
    });
  });

  it('answers empty lists for a patient without entries', () => {
    expect(patientBalance('p1', [])).toEqual({ patientId: 'p1', balances: [], charged: [] });
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

  it('desc: largest debts first, then the rest, then credits least negative first', () => {
    expect(rankByBalance(patients, 'desc', 'USD')).toEqual({
      ids: ['dia', 'ada', 'gus', 'ben', 'hal', 'eli'],
      keys: [1, 2, 2, 4, 4, 5],
      restKey: 3,
    });
  });

  it('asc: largest credits first, then the rest, then debts smallest first', () => {
    expect(rankByBalance(patients, 'asc', 'USD')).toEqual({
      ids: ['eli', 'ben', 'hal', 'ada', 'gus', 'dia'],
      keys: [1, 2, 2, 4, 4, 5],
      restKey: 3,
    });
  });

  it('ranks by the tenant currency only', () => {
    expect(rankByBalance(patients, 'desc', 'EUR')).toEqual({
      ids: ['fay', 'gus'],
      keys: [1, 3],
      restKey: 2,
    });
  });

  it('gives equal amounts the same key, so the search breaks the tie by name', () => {
    const tied = [
      { patientId: 'b', balances: [usd('5.00')] },
      { patientId: 'a', balances: [usd('5')] },
      { patientId: 'd', balances: [usd('-5.00')] },
      { patientId: 'c', balances: [usd('-5.00')] },
    ];
    expect(rankByBalance(tied, 'desc', 'USD')).toEqual({
      ids: ['b', 'a', 'd', 'c'],
      keys: [1, 1, 3, 3],
      restKey: 2,
    });
    expect(rankByBalance(tied, 'asc', 'USD')).toEqual({
      ids: ['d', 'c', 'b', 'a'],
      keys: [1, 1, 3, 3],
      restKey: 2,
    });
  });

  it('puts the rest first or last when one side is empty', () => {
    const debts = [
      { patientId: 'a', balances: [usd('1.00')] },
      { patientId: 'b', balances: [] },
      { patientId: 'z', balances: [usd('3.00')] },
    ];
    expect(rankByBalance(debts, 'desc', 'USD')).toEqual({
      ids: ['z', 'a'],
      keys: [1, 2],
      restKey: 3,
    });
    expect(rankByBalance(debts, 'asc', 'USD')).toEqual({
      ids: ['a', 'z'],
      keys: [2, 3],
      restKey: 1,
    });
    const credits = [{ patientId: 'c', balances: [usd('-1.00')] }];
    expect(rankByBalance(credits, 'desc', 'USD')).toEqual({ ids: ['c'], keys: [2], restKey: 1 });
    expect(rankByBalance(credits, 'asc', 'USD')).toEqual({ ids: ['c'], keys: [1], restKey: 2 });
  });

  it('ranks nobody when every balance is zero', () => {
    expect(rankByBalance([{ patientId: 'a', balances: [] }], 'desc', 'USD')).toEqual({
      ids: [],
      keys: [],
      restKey: 1,
    });
    expect(rankByBalance([{ patientId: 'a', balances: [usd('0.00')] }], 'asc', 'USD')).toEqual({
      ids: [],
      keys: [],
      restKey: 1,
    });
    expect(rankByBalance([], 'asc', 'USD')).toEqual({ ids: [], keys: [], restKey: 1 });
  });
});
