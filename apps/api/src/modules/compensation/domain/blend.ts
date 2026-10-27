import { fromCents, type ShareComponent, toCents } from '@dcm/contracts';
import { BASIS, percentToHundredths, prorate, type Rate, ratePercent } from './money';

/** A visit's charge as charged: its net amount (after the visit discount) and its lines. */
export interface ChargeLinesFact {
  visitId: string;
  net: string;
  currency: string;
  lines: { code: string; amount: string }[];
}

export interface VisitRate {
  rate: Rate;
  /** Rates by service applied to the visit's lines (shown as "30.48 % (blended)"). */
  blended: boolean;
  lines: { code: string; amount: string; percent: string }[];
}

/** The percent of one service code: its code's override, else its category's, else the default. */
function percentOf(
  share: ShareComponent,
  code: string,
  categories: ReadonlyMap<string, string | null>,
): string {
  const byCode = share.rateOverrides.find(
    (override) => override.target === 'service' && override.key === code,
  );
  if (byCode) return byCode.percent;
  const category = categories.get(code) ?? null;
  const byCategory =
    category === null
      ? undefined
      : share.rateOverrides.find(
          (override) => override.target === 'category' && override.key === category,
        );
  return byCategory?.percent ?? share.percent;
}

/**
 * The visit's rate for a share (ADR-0059): the charge's lines pro-rated to its net amount (the
 * visit discount spread proportionally), each line at its own percent; the blended rate is
 * Σ(line × percent) / net. Without overrides, a charge or a net amount, it is the default percent.
 * Amendments add no lines, so they do not re-blend.
 */
export function visitRate(
  share: ShareComponent,
  charge: ChargeLinesFact | undefined,
  categories: ReadonlyMap<string, string | null>,
): VisitRate {
  const plain: VisitRate = {
    rate: { num: percentToHundredths(share.percent), den: BASIS },
    blended: false,
    lines: [],
  };
  if (share.rateOverrides.length === 0 || !charge || charge.lines.length === 0) return plain;
  const net = toCents(charge.net);
  if (net <= 0n) return plain;
  const parts = prorate(
    charge.lines.map((line) => toCents(line.amount)),
    net,
  );
  const lines = charge.lines.map((line, index) => ({
    code: line.code,
    amount: parts[index] ?? 0n,
    percent: percentOf(share, line.code, categories),
  }));
  const defaultHundredths = percentToHundredths(share.percent);
  if (lines.every((line) => percentToHundredths(line.percent) === defaultHundredths)) return plain;
  const num = lines.reduce(
    (sum, line) => sum + line.amount * percentToHundredths(line.percent),
    0n,
  );
  return {
    rate: { num, den: net * BASIS },
    blended: true,
    lines: lines.map((line) => ({
      code: line.code,
      amount: fromCents(line.amount),
      percent: ratePercent({ num: percentToHundredths(line.percent), den: BASIS }),
    })),
  };
}
