import { toCents } from '@dcm/contracts';

/** A line of a visit entry: its service code, name and final price. */
export interface SplitLine {
  code: string;
  name: string;
  amount: string;
}

/**
 * A visit's ledger entries in the order they were made: a charge's lines are the visit as
 * charged, a correction's the visit as it stands after it (ADR-0062); a reversal has none.
 */
export interface SplitHistory {
  entries: readonly { id: string; amount: string; lines: readonly SplitLine[] }[];
}

/**
 * `total` spread over `weights` (cents), largest remainder first, the sign of `total` kept; with
 * all weights 0 the first takes it all. The parts always sum to `total`.
 */
export function prorate(weights: readonly bigint[], total: bigint): bigint[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  if (sum === 0n) return weights.map((_, index) => (index === 0 ? total : 0n));
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const parts = weights.map((weight) => (weight * magnitude) / sum);
  let rest = magnitude - parts.reduce((acc, part) => acc + part, 0n);
  const order = weights
    .map((weight, index) => ({ index, remainder: (weight * magnitude) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  for (const { index } of order) {
    if (rest === 0n) break;
    parts[index] = (parts[index] ?? 0n) + 1n;
    rest -= 1n;
  }
  return parts.map((part) => (negative ? -part : part));
}

/** Each code's share of the visit's net amount at a state: its lines pro-rated to the net. */
function shares(lines: readonly SplitLine[], net: bigint): Map<string, bigint> {
  const parts = prorate(
    lines.map((line) => toCents(line.amount)),
    net,
  );
  const byCode = new Map<string, bigint>();
  lines.forEach((line, index) => {
    byCode.set(line.code, (byCode.get(line.code) ?? 0n) + (parts[index] ?? 0n));
  });
  return byCode;
}

/**
 * Production by service (feature 19): every entry in `counted` moves each code from its share of
 * the visit before the entry to its share after it — a charge from nothing to its lines, a
 * correction from the old lines to the new, a reversal back to nothing. The parts of an entry sum
 * to its amount, so a voided visit nets to zero per code. Cents per code, with the latest name.
 */
export function splitByService(
  histories: readonly SplitHistory[],
  counted: ReadonlySet<string>,
): Map<string, { name: string; cents: bigint }> {
  const result = new Map<string, { name: string; cents: bigint }>();
  for (const history of histories) {
    let net = 0n;
    let lines: readonly SplitLine[] = [];
    for (const entry of history.entries) {
      const before = shares(lines, net);
      net += toCents(entry.amount);
      if (entry.lines.length > 0) lines = entry.lines;
      if (!counted.has(entry.id)) continue;
      const after = shares(lines, net);
      for (const code of new Set([...before.keys(), ...after.keys()])) {
        const delta = (after.get(code) ?? 0n) - (before.get(code) ?? 0n);
        const name = lines.find((line) => line.code === code)?.name ?? result.get(code)?.name;
        const row = result.get(code) ?? { name: name ?? code, cents: 0n };
        row.cents += delta;
        if (name) row.name = name;
        result.set(code, row);
      }
    }
  }
  return result;
}
