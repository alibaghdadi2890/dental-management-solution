/**
 * Stock as movements over batches (ADR-0095), the pure part: which batches a take-out leaves,
 * where a count's difference goes, what stock is worth. No I/O; the services lock the batches
 * and write what these functions decide.
 */

export interface BatchState {
  id: string;
  expiresOn: string | null;
  receivedOn: string;
  left: number;
}

/** One batch's share of a movement: signed, as written to `inventory_movement_batches`. */
export interface BatchShare {
  batchId: string;
  quantity: number;
}

const NO_EXPIRY = '9999-12-31';

/**
 * The order stock leaves in (B3): the batch that expires first (no expiry last), then the oldest
 * received, then the first recorded (uuid v7 ids sort in the order they were made).
 */
export function takeOrder<T extends BatchState>(batches: readonly T[]): T[] {
  return [...batches].sort(
    (a, b) =>
      (a.expiresOn ?? NO_EXPIRY).localeCompare(b.expiresOn ?? NO_EXPIRY) ||
      a.receivedOn.localeCompare(b.receivedOn) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The batches `quantity` units leave, as negative shares: the chosen batch first when there is
 * one, then the take order. Null when the batches hold fewer than `quantity` (nothing is taken).
 */
export function allocate(
  batches: readonly BatchState[],
  quantity: number,
  chosenBatchId: string | null = null,
): BatchShare[] | null {
  const ordered = takeOrder(batches.filter((batch) => batch.left > 0));
  const chosen = ordered.find((batch) => batch.id === chosenBatchId);
  const queue = chosen ? [chosen, ...ordered.filter((batch) => batch !== chosen)] : ordered;
  const shares: BatchShare[] = [];
  let wanted = quantity;
  for (const batch of queue) {
    if (wanted === 0) break;
    const taken = Math.min(batch.left, wanted);
    shares.push({ batchId: batch.id, quantity: -taken });
    wanted -= taken;
  }
  return wanted === 0 ? shares : null;
}

export const onHandOf = (batches: readonly BatchState[]): number =>
  batches.reduce((sum, batch) => sum + batch.left, 0);

/** The newest batch, which a count's surplus joins (B5): the last received, then recorded. */
export function newestBatch<T extends BatchState>(batches: readonly T[]): T | undefined {
  return [...batches].sort(
    (a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.id.localeCompare(a.id),
  )[0];
}

/** What applying one counted line does (D6). */
export type CountPlan =
  | { kind: 'none' }
  /** The item never had a batch in the branch: its first count is its opening stock. */
  | { kind: 'opening'; quantity: number }
  | { kind: 'change'; quantity: number; shares: BatchShare[] };

/**
 * A counted line's change: `counted − systemThen`, applied to the stock as it is now, so a
 * movement recorded between the count and Apply is neither lost nor counted twice. A shortage
 * leaves the batches in take order and never more than is there; a surplus joins the newest
 * batch.
 */
export function planCount(
  counted: number,
  systemThen: number,
  batches: readonly BatchState[],
): CountPlan {
  const difference = counted - systemThen;
  if (batches.length === 0) {
    return counted > 0 ? { kind: 'opening', quantity: counted } : { kind: 'none' };
  }
  if (difference === 0) return { kind: 'none' };
  if (difference > 0) {
    const newest = newestBatch(batches) as BatchState;
    return {
      kind: 'change',
      quantity: difference,
      shares: [{ batchId: newest.id, quantity: difference }],
    };
  }
  const shortage = Math.min(-difference, onHandOf(batches));
  if (shortage === 0) return { kind: 'none' };
  const shares = allocate(batches, shortage) as BatchShare[];
  return { kind: 'change', quantity: -shortage, shares };
}

/** A batch as valued (D4): what `quantity` units cost, `amount` cents, null while to price. */
export interface ValuedBatch {
  quantity: number;
  amountCents: bigint | null;
}

/**
 * What `units` of a batch are worth, in cents, rounded half away from zero: each batch at its own
 * unit cost (`amount / quantity`), exact until the one rounding. Null while it is to price.
 */
export function valueOf(batch: ValuedBatch, units: number): bigint | null {
  if (batch.amountCents === null) return null;
  if (batch.quantity <= 0 || units === 0) return 0n;
  const numerator = batch.amountCents * BigInt(units);
  const denominator = BigInt(batch.quantity);
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  return sign * ((magnitude * 2n + denominator) / (denominator * 2n));
}

/**
 * Stock value of a set of batches with what is left of each (E): priced batches only; the
 * unpriced ones are counted apart.
 */
export function stockValue(batches: readonly (ValuedBatch & { left: number })[]): {
  cents: bigint;
  unpricedUnits: number;
} {
  let cents = 0n;
  let unpricedUnits = 0;
  for (const batch of batches) {
    const value = valueOf(batch, batch.left);
    if (value === null) unpricedUnits += batch.left;
    else cents += value;
  }
  return { cents, unpricedUnits };
}
