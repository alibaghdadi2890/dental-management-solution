import type { BalanceState } from '@dcm/contracts';

/**
 * Owes, in credit or settled, from a patient's balance in each currency (positive = owes): owing
 * in any currency wins, then credit in any (search S9). Exact: read from the decimal text.
 */
export function balanceStateOf(amounts: readonly string[]): BalanceState['state'] {
  const nonZero = amounts.filter((amount) => /[1-9]/.test(amount));
  if (nonZero.some((amount) => !amount.startsWith('-'))) return 'owes';
  return nonZero.length > 0 ? 'credit' : 'settled';
}
