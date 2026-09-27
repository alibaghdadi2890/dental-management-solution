import type { BalanceMoney } from '@dcm/contracts';

/** The balance to show first (design Q13): the tenant currency's, else the first non-zero one in
 * another currency; `undefined` when there is none. */
export function leadingBalance(
  balances: readonly BalanceMoney[],
  currency: string,
): BalanceMoney | undefined {
  return (
    balances.find((balance) => balance.currency === currency) ??
    balances.find((balance) => Number(balance.amount) !== 0)
  );
}
