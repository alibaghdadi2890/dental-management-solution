import { toCents } from '@dcm/contracts';

/**
 * Compensation arithmetic on integer cents and exact rationals (ADR-0059): a share is computed
 * as one fraction and rounded once, half away from zero, so a statement adds up line by line.
 */

/** A rate as a fraction: a share of `base` cents is `base × num / den`. */
export interface Rate {
  num: bigint;
  den: bigint;
}

/** Hundredths of a percent per whole: 40 % = 4000 / 10000. */
export const BASIS = 10_000n;

/** `"30.48"` → 3048 (hundredths of a percent). */
export function percentToHundredths(percent: string): bigint {
  return toCents(percent);
}

export function rateOfPercent(percent: string): Rate {
  return { num: percentToHundredths(percent), den: BASIS };
}

/** `num / den` rounded half away from zero; `den` > 0. */
export function roundDiv(num: bigint, den: bigint): bigint {
  const negative = num < 0n;
  const magnitude = negative ? -num : num;
  const quotient = (magnitude * 2n + den) / (den * 2n);
  return negative ? -quotient : quotient;
}

export function applyRate(baseCents: bigint, rate: Rate): bigint {
  return roundDiv(baseCents * rate.num, rate.den);
}

/** A rate shown with 2 decimals: `30.48`. */
export function ratePercent(rate: Rate): string {
  const hundredths = roundDiv(rate.num * BASIS, rate.den);
  const sign = hundredths < 0n ? '-' : '';
  const magnitude = hundredths < 0n ? -hundredths : hundredths;
  return `${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
}

/**
 * Splits `total` over `weights` in proportion, so the parts sum to `total` exactly (largest
 * remainder; ties to the earlier part). All weights 0 → all parts 0 but the first, which takes
 * the total.
 */
export function prorate(weights: readonly bigint[], total: bigint): bigint[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  if (weights.length === 0) return [];
  if (sum === 0n) return weights.map((_, index) => (index === 0 ? total : 0n));
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const floors = weights.map((weight) => (weight * magnitude) / sum);
  let rest = magnitude - floors.reduce((acc, part) => acc + part, 0n);
  const order = weights
    .map((weight, index) => ({ index, remainder: (weight * magnitude) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  for (const { index } of order) {
    if (rest === 0n) break;
    floors[index] = (floors[index] ?? 0n) + 1n;
    rest -= 1n;
  }
  return floors.map((part) => (negative ? -part : part));
}
