/**
 * Integer-cents money arithmetic (CLAUDE.md §7: money is `numeric(12,2)` decimal strings, never
 * floats). Shared by every module that sums or rounds money on `bigint` cents:
 * `apps/api/src/modules/billing/domain/balances.ts` and `visit-money.ts`. Pure — no Zod, no I/O.
 * Negative amounts parse and format correctly (ledger adjustments and credits are negative);
 * callers that must reject a negative value check the parsed `bigint` themselves.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** Parses a decimal string (at most 2 decimals, optionally negative) into integer cents. Callers
 * only ever pass values already validated by a Zod decimal-amount schema, so a mismatch here is a
 * bug, not user input. */
export function toCents(amount: string): bigint {
  const match = DECIMAL.exec(amount);
  if (!match) throw new RangeError(`Not a decimal amount with at most 2 decimals: "${amount}"`);
  const [, minus, units = '0', fraction = ''] = match;
  const cents = BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minus ? -cents : cents;
}

/** Formats integer cents back into a decimal string with exactly 2 decimals. */
export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const magnitude = cents < 0n ? -cents : cents;
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return `${sign}${(magnitude / 100n).toString()}.${fraction}`;
}
