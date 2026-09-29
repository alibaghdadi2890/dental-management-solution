/**
 * Visit money (feature 4a, spec V7): the discount/total arithmetic for a live visit, shared
 * verbatim between the server (`clinical/domain`, which imports it from here) and the SPA's live
 * preview, so both round exactly the same way. Pure — no Nest, no Zod, no I/O (CLAUDE.md §4
 * domain purity) — everything is computed on integer cents (`bigint`), never floats, the same
 * approach as `apps/api/src/modules/billing/domain/balances.ts`.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** Parses a decimal string (at most 2 decimals) into integer cents. Callers only ever pass values
 * already validated by a Zod decimal-amount schema, so a mismatch here is a bug, not user input. */
function toCents(amount: string): bigint {
  const match = DECIMAL.exec(amount);
  if (!match) throw new RangeError(`Not a decimal amount with at most 2 decimals: "${amount}"`);
  const [, minus, units = '0', fraction = ''] = match;
  const cents = BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minus ? -cents : cents;
}

/** Formats integer cents back into a decimal string with exactly 2 decimals. */
function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const magnitude = cents < 0n ? -cents : cents;
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return `${sign}${(magnitude / 100n).toString()}.${fraction}`;
}

export const DISCOUNT_MODES = ['percent', 'amount'] as const;
export type DiscountMode = (typeof DISCOUNT_MODES)[number];

/** One service line's price, decimal strings: the catalog base price and its recorded discount. */
export interface MoneyLine {
  base: string;
  discount: string;
}

/** The visit-level totals. `subtotal` is Σ `lineFinal` over the lines; `discount` is the
 * visit-level discount applied on top of the subtotal; `total = subtotal − discount`; `capped`
 * flags that the raw discount entry exceeded its cap (percent > 100%, or amount > subtotal). */
export interface VisitMoney {
  subtotal: string;
  discount: string;
  total: string;
  capped: boolean;
}

/** One service line's charged amount: `base − discount`. */
export function lineFinal(line: MoneyLine): string {
  return fromCents(toCents(line.base) - toCents(line.discount));
}

const PERCENT_SCALE = 100n; // a percent value (e.g. "12.50") → hundredths of a percent (1250)
const PERCENT_CAP = 100n * PERCENT_SCALE; // 100.00%, in hundredths of a percent
const HALF_PERCENT_CAP = PERCENT_CAP / 2n; // added before dividing, for round-half-up

/**
 * The visit-level discount and total, computed from the line subtotal.
 *
 * `mode: 'percent'`: `value` is a percentage as a decimal string (e.g. `'12.50'` = 12.5%), parsed
 * into hundredths of a percent the same way a money amount is parsed into cents. It is capped at
 * 100% and the discount is rounded half up: `(subtotal × min(P, 10000) + 5000) / 10000`.
 *
 * `mode: 'amount'`: `value` is a decimal amount capped at the subtotal.
 *
 * `capped` reports whether the *raw* entry (before capping) exceeded its cap, so the caller can
 * warn without recomputing.
 */
export function visitMoney(lines: MoneyLine[], mode: DiscountMode, value: string): VisitMoney {
  const subtotalCents = lines.reduce(
    (sum, line) => sum + (toCents(line.base) - toCents(line.discount)),
    0n,
  );
  const rawValueCents = toCents(value);

  let discountCents: bigint;
  let capped: boolean;
  if (mode === 'percent') {
    const cappedPercent = rawValueCents > PERCENT_CAP ? PERCENT_CAP : rawValueCents;
    discountCents = (subtotalCents * cappedPercent + HALF_PERCENT_CAP) / PERCENT_CAP;
    capped = rawValueCents > PERCENT_CAP;
  } else {
    discountCents = rawValueCents > subtotalCents ? subtotalCents : rawValueCents;
    capped = rawValueCents > subtotalCents;
  }

  return {
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    total: fromCents(subtotalCents - discountCents),
    capped,
  };
}

/** Whole minutes elapsed, rounded up, at least 1: a visit that starts and completes inside the
 * same minute still counts as one minute (spec: duration rounding). */
export function durationMinutes(elapsedSeconds: number): number {
  return Math.max(1, Math.ceil(elapsedSeconds / 60));
}
