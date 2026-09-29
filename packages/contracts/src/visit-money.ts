/**
 * Visit money (feature 4a, spec V7): the discount/total arithmetic for a live visit, shared
 * verbatim between the server (`clinical/domain`, which imports it from here) and the SPA's live
 * preview, so both round exactly the same way. Pure — no Nest, no Zod, no I/O (CLAUDE.md §4
 * domain purity) — everything is computed on integer cents (`bigint`), never floats, via
 * `cents.ts` (also shared by `apps/api/src/modules/billing/domain/balances.ts`).
 */

import { fromCents, toCents } from './cents.js';

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

/** Parses and validates one line: `0 ≤ discount ≤ base` (the same invariant `visit_services`
 * enforces in the database), `base ≥ 0`. */
function parseLine(line: MoneyLine): { base: bigint; discount: bigint } {
  const base = toCents(line.base);
  const discount = toCents(line.discount);
  if (base < 0n) throw new RangeError(`Line base must not be negative: "${line.base}"`);
  if (discount < 0n || discount > base) {
    throw new RangeError(`Line discount must be between 0 and the base: "${line.discount}"`);
  }
  return { base, discount };
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
 *
 * Throws `RangeError` on an impossible input: a negative discount `value`, a negative line base,
 * or a line discount that exceeds its base — none of these can happen through the Zod schemas
 * and DB constraints that produce these values, so a throw here means a caller bug.
 */
export function visitMoney(lines: MoneyLine[], mode: DiscountMode, value: string): VisitMoney {
  const rawValueCents = toCents(value);
  if (rawValueCents < 0n) throw new RangeError(`Discount value must not be negative: "${value}"`);

  const subtotalCents = lines.reduce((sum, line) => {
    const { base, discount } = parseLine(line);
    return sum + (base - discount);
  }, 0n);

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
