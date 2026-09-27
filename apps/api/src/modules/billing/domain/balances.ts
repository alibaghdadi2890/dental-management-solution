import type { BalanceMoney } from '@dcm/contracts';

/**
 * Balance rules (design Q13): a balance is Σ amount per currency — never converted between
 * currencies. ("Owing" — any currency's sum is positive — is evaluated in SQL by the repository.)
 * Amounts are decimal strings (`numeric(12,2)` per entry, CLAUDE.md §7; sums can be wider);
 * arithmetic runs on integer cents as `bigint`, never on floats.
 */

const AMOUNT = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

function toCents(amount: string): bigint {
  const match = AMOUNT.exec(amount);
  if (!match) throw new RangeError(`Not a decimal amount with at most 2 decimals: "${amount}"`);
  const [, minus, units = '0', fraction = ''] = match;
  const cents = BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minus ? -cents : cents;
}

function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const magnitude = cents < 0n ? -cents : cents;
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return `${sign}${(magnitude / 100n).toString()}.${fraction}`;
}

/**
 * Sums `entries` per currency. Currencies that net to zero are dropped (a settled balance is no
 * balance); the result is ordered by currency code so it's stable across calls. `[]` for none.
 */
export function sumBalances(entries: readonly BalanceMoney[]): BalanceMoney[] {
  const totals = new Map<string, bigint>();
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0n) + toCents(entry.amount));
  }
  return [...totals]
    .filter(([, cents]) => cents !== 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, cents]) => ({ amount: fromCents(cents), currency }));
}

export interface BalanceRank {
  /** Patients with a non-zero balance in the tenant currency, in rank order. */
  ids: string[];
  /**
   * Where everyone else (a zero or no balance in the tenant currency) goes: the number of `ids`
   * ranked before them — `0` = before all of `ids`, `ids.length` = after all of them. A 0-based
   * insertion index, *not* a 1-based array position: the rest sort strictly between
   * `ids[restAt - 1]` and `ids[restAt]`, never tied with either.
   */
  restAt: number;
}

/**
 * The order of "sort by balance" (design Q7), by the tenant-currency amount only (other
 * currencies are never converted, so they count as zero here). `desc`: largest debts first, then
 * the rest, then credits, least negative first — descending overall. `asc` mirrors it: largest
 * credits first, then the rest, then debts, smallest first. Ties keep input order, so passing
 * patients in name order breaks ties by name.
 */
export function rankByBalance(
  patients: readonly { patientId: string; balances: readonly BalanceMoney[] }[],
  dir: 'asc' | 'desc',
  tenantCurrency: string,
): BalanceRank {
  const ranked = patients
    .map((patient, index) => {
      const own = patient.balances.find((balance) => balance.currency === tenantCurrency);
      return { id: patient.patientId, cents: own ? toCents(own.amount) : 0n, index };
    })
    .filter((patient) => patient.cents !== 0n);
  const sign = dir === 'desc' ? -1 : 1;
  // Array.prototype.sort is stable, but compare the input index too so ties never depend on it.
  ranked.sort((a, b) => {
    if (a.cents !== b.cents) return (a.cents < b.cents ? -1 : 1) * sign;
    return a.index - b.index;
  });
  const before = ranked.filter((patient) =>
    dir === 'desc' ? patient.cents > 0n : patient.cents < 0n,
  );
  return { ids: ranked.map((patient) => patient.id), restAt: before.length };
}
