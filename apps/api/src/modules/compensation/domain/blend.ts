import { fromCents, type ShareComponent, type StatementRate, toCents } from '@dcm/contracts';
import { applyRate, BASIS, percentToHundredths, prorate, type Rate, ratePercent } from './money';

/** A line of a visit as charged: its service code and final price. */
export interface ChargeLine {
  code: string;
  amount: string;
}

/**
 * A visit's ledger entries in the order they were made, each with its lines: a charge's are the
 * visit as charged, a correction's the visit as it stands after it (ADR-0062); others have none.
 */
export interface ChargeHistory {
  visitId: string;
  entries: readonly { id: string; amount: string; lines: readonly ChargeLine[] }[];
}

/** The visit after one of its entries: the net charged so far and its lines then. */
export interface ChargeState {
  net: string;
  lines: readonly ChargeLine[];
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
 * The visit's rate for a share (ADR-0059): the lines pro-rated to the net amount (the visit
 * discount spread proportionally), each line at its own percent; the blended rate is
 * Σ(line × percent) / net. Without overrides, a state, lines or a net amount, it is the default
 * percent.
 */
export function visitRate(
  share: ShareComponent,
  state: ChargeState | null | undefined,
  categories: ReadonlyMap<string, string | null>,
): VisitRate {
  const plain: VisitRate = {
    rate: { num: percentToHundredths(share.percent), den: BASIS },
    blended: false,
    lines: [],
  };
  if (share.rateOverrides.length === 0 || !state || state.lines.length === 0) return plain;
  const net = toCents(state.net);
  if (net <= 0n) return plain;
  const parts = prorate(
    state.lines.map((line) => toCents(line.amount)),
    net,
  );
  const lines = state.lines.map((line, index) => ({
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

/** The visit after each entry: the cumulative net, and the latest lines given. */
function statesOf(history: ChargeHistory): { id: string; lined: boolean; state: ChargeState }[] {
  let net = 0n;
  let lines: readonly ChargeLine[] = [];
  return history.entries.map((entry) => {
    net += toCents(entry.amount);
    if (entry.lines.length > 0) lines = entry.lines;
    return { id: entry.id, lined: entry.lines.length > 0, state: { net: fromCents(net), lines } };
  });
}

/** The visit as it stands now: after its last entry. */
export function latestState(history: ChargeHistory | undefined): ChargeState | null {
  if (!history) return null;
  return statesOf(history).at(-1)?.state ?? null;
}

const sameLines = (a: readonly ChargeLine[], b: readonly ChargeLine[]) =>
  a.length === b.length &&
  a.every((line, index) => {
    const other = b[index];
    return other !== undefined && line.code === other.code && line.amount === other.amount;
  });

const sameRate = (a: Rate, b: Rate) => a.num * b.den === b.num * a.den;

const shown = (rate: VisitRate): StatementRate => ({
  percent: ratePercent(rate.rate),
  blended: rate.blended,
  lines: rate.lines,
});

/**
 * What a share earns on one production entry of a visit (ADR-0059, ADR-0062), in cents, and the
 * rate shown. An entry is rated at the visit's lines before it — a charge at its own. A correction
 * that changed the lines and so the rate earns the difference it makes: E(after) − E(before),
 * where E is the net so far at that state's rate; its rate shown is what it earns over its amount.
 */
export function entryShare(
  share: ShareComponent,
  entry: { id: string; amount: string },
  history: ChargeHistory | undefined,
  categories: ReadonlyMap<string, string | null>,
): { amount: bigint; rate: StatementRate } {
  const states = history ? statesOf(history) : [];
  const index = states.findIndex((state) => state.id === entry.id);
  const current = states[index];
  const previous = index > 0 ? states[index - 1] : undefined;
  const before = visitRate(share, previous?.state ?? current?.state, categories);
  if (current?.lined && previous && !sameLines(previous.state.lines, current.state.lines)) {
    const after = visitRate(share, current.state, categories);
    if (!sameRate(before.rate, after.rate)) {
      const earned =
        applyRate(toCents(current.state.net), after.rate) -
        applyRate(toCents(previous.state.net), before.rate);
      const base = toCents(entry.amount);
      const effective = base < 0n ? { num: -earned, den: -base } : { num: earned, den: base };
      return {
        amount: earned,
        rate: { percent: ratePercent(effective), blended: true, lines: after.lines },
      };
    }
  }
  return { amount: applyRate(toCents(entry.amount), before.rate), rate: shown(before) };
}

/** What a share earns on a collection: at the visit's rate as it stands now. */
export function collectionShare(
  share: ShareComponent,
  amount: string,
  history: ChargeHistory | undefined,
  categories: ReadonlyMap<string, string | null>,
): { amount: bigint; rate: StatementRate } {
  const rate = visitRate(share, latestState(history), categories);
  return { amount: applyRate(toCents(amount), rate.rate), rate: shown(rate) };
}
