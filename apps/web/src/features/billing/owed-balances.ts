import type { BalanceMoney } from '@dcm/contracts';

/**
 * Every non-zero balance, the tenant currency's first and the others in the order the API returned
 * them (design Q13: "the UI leads with the tenant currency and lists others after it"). A single
 * cell shows the first — so a zero tenant-currency balance never hides a debt in another currency.
 */
export function owedBalances(balances: readonly BalanceMoney[], currency: string): BalanceMoney[] {
  const nonZero = balances.filter((balance) => Number(balance.amount) !== 0);
  return [
    ...nonZero.filter((balance) => balance.currency === currency),
    ...nonZero.filter((balance) => balance.currency !== currency),
  ];
}
