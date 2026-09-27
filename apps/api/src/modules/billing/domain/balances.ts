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

/** `PatientsService.search`'s rank: `keys[i]` is the sort key of `ids[i]` (ascending). */
export interface BalanceRank {
  /** Patients with a non-zero balance in the tenant currency, in key order. */
  ids: string[];
  /** Dense rank of each patient's amount: equal amounts share a key. */
  keys: number[];
  /** The key of everyone else (a zero or no balance in the tenant currency). */
  restKey: number;
}

/**
 * The order of "sort by balance" (design Q7), by the tenant-currency amount only (other
 * currencies are never converted, so they count as zero here). A dense rank over the distinct
 * amounts, zero included — zero's key is `restKey`:
 * - `desc`: debts, largest first (keys `1..p`); then everyone else (`p + 1`); then credits, least
 *   negative first — descending overall.
 * - `asc`: the mirror image — credits, most negative first; then everyone else; then debts,
 *   smallest first.
 *
 * Equal amounts share a key, so `search` orders them (and the rest) by name.
 */
export function rankByBalance(
  patients: readonly { patientId: string; balances: readonly BalanceMoney[] }[],
  dir: 'asc' | 'desc',
  tenantCurrency: string,
): BalanceRank {
  const owned = patients.map((patient) => {
    const own = patient.balances.find((balance) => balance.currency === tenantCurrency);
    return { id: patient.patientId, cents: own ? toCents(own.amount) : 0n };
  });
  const sign = dir === 'desc' ? -1 : 1;
  const compare = (a: bigint, b: bigint) => (a === b ? 0 : (a < b ? -1 : 1) * sign);
  const distinct = [...new Set([0n, ...owned.map((patient) => patient.cents)])].sort(compare);
  const keyOf = new Map(distinct.map((cents, index) => [cents, index + 1]));
  const key = (cents: bigint) => keyOf.get(cents) ?? 0;
  const ranked = owned
    .filter((patient) => patient.cents !== 0n)
    .sort((a, b) => compare(a.cents, b.cents));
  return {
    ids: ranked.map((patient) => patient.id),
    keys: ranked.map((patient) => key(patient.cents)),
    restKey: key(0n),
  };
}
