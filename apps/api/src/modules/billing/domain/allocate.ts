/**
 * Payment allocation (feature 5, spec P2–P5, ADR-0027): which charges ("targets") the money of a
 * payment, a write-off or applied credit ("sources") covers. Allocations are a stored, derived
 * explanation — the balance is always Σ ledger — so these functions only decide rows to append.
 * Pure: integer cents (`bigint`), one patient and one currency at a time (the caller groups).
 *
 * - A **target** is an `opening_balance` or `adjustment` above zero, or a visit (its
 *   `visit_charge`, netted with its corrections). It can absorb up to `max(net, 0)`.
 * - A **source** is a `payment` or a credit entry (`adjustment` / `opening_balance` below zero).
 *   It can cover up to `capacity` (its amount, less refunds; 0 once voided).
 * - **Pairs** are the current allocation sums per (source, target), with `order` = the position of
 *   their latest row, so "newest first" releases undo the most recent allocations.
 */

export interface AllocationTarget {
  entryId: string;
  /** `YYYY-MM-DD`: the charge date (an opening balance's as-of, an adjustment's effective date). */
  date: string;
  /** Epoch ms of the entry, the tie-break after the date. */
  createdAt: number;
  net: bigint;
}

export interface AllocationSource {
  entryId: string;
  date: string;
  createdAt: number;
  capacity: bigint;
}

export interface AllocationPair {
  sourceId: string;
  targetId: string;
  amount: bigint;
  /** Higher = more recent. */
  order: number;
}

export type AllocationKind = 'allocation' | 'credit_applied' | 'release';

export interface NewAllocation {
  sourceId: string;
  targetId: string;
  /** Negative for a release. */
  amount: bigint;
  kind: AllocationKind;
  manual: boolean;
}

/** Oldest first: by date, then creation, then id (stable). */
export function byAge<T extends { date: string; createdAt: number; entryId: string }>(
  a: T,
  b: T,
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
}

const max0 = (value: bigint) => (value > 0n ? value : 0n);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

function sumBy(pairs: Iterable<AllocationPair>, key: 'sourceId' | 'targetId'): Map<string, bigint> {
  const sums = new Map<string, bigint>();
  for (const pair of pairs) sums.set(pair[key], (sums.get(pair[key]) ?? 0n) + pair.amount);
  return sums;
}

/** What each target still owes: `max(net, 0) − allocated`, never below 0. */
export function outstandingByTarget(
  targets: readonly AllocationTarget[],
  pairs: readonly AllocationPair[],
): Map<string, bigint> {
  const allocated = sumBy(pairs, 'targetId');
  return new Map(
    targets.map((target) => [
      target.entryId,
      max0(max0(target.net) - (allocated.get(target.entryId) ?? 0n)),
    ]),
  );
}

/** What each source has not allocated yet (its part of the account credit), never below 0. */
export function unallocatedBySource(
  sources: readonly AllocationSource[],
  pairs: readonly AllocationPair[],
): Map<string, bigint> {
  const allocated = sumBy(pairs, 'sourceId');
  return new Map(
    sources.map((source) => [
      source.entryId,
      max0(source.capacity - (allocated.get(source.entryId) ?? 0n)),
    ]),
  );
}

export interface PaymentPlanInput {
  amount: bigint;
  /** Every target of the paid account(s), any order. */
  targets: readonly AllocationTarget[];
  pairs: readonly AllocationPair[];
  /** B4: absorbs first, capped at its own outstanding; flagged `manual`. */
  manualTargetId?: string;
  /** B2 (1): the visit the payment was opened from. */
  contextTargetId?: string;
}

export interface PlannedAllocation {
  targetId: string;
  amount: bigint;
  manual: boolean;
}

/**
 * B2/B4: a new payment's allocations — the manual target, then the context visit, then open
 * targets oldest first; each absorbs at most its outstanding. `unallocated` is what no target
 * could take (the caller refuses an amount above the outstanding, so it is 0 in practice).
 */
export function planPayment(input: PaymentPlanInput): {
  allocations: PlannedAllocation[];
  unallocated: bigint;
} {
  const outstanding = outstandingByTarget(input.targets, input.pairs);
  const first = [input.manualTargetId, input.contextTargetId].filter(
    (id): id is string => id !== undefined,
  );
  const rest = [...input.targets]
    .sort(byAge)
    .map((target) => target.entryId)
    .filter((id) => !first.includes(id));
  let left = input.amount;
  const allocations: PlannedAllocation[] = [];
  for (const targetId of [...new Set(first), ...rest]) {
    if (left <= 0n) break;
    const take = min(left, outstanding.get(targetId) ?? 0n);
    if (take <= 0n) continue;
    allocations.push({ targetId, amount: take, manual: targetId === input.manualTargetId });
    left -= take;
  }
  return { allocations, unallocated: left };
}

/** Releases `excess` from `pairs`, newest first; mutates the pair amounts. */
function releaseNewestFirst(pairs: AllocationPair[], excess: bigint, out: NewAllocation[]): void {
  let left = excess;
  for (const pair of [...pairs].sort((a, b) => b.order - a.order)) {
    if (left <= 0n) break;
    const take = min(left, pair.amount);
    if (take <= 0n) continue;
    pair.amount -= take;
    left -= take;
    out.push({
      sourceId: pair.sourceId,
      targetId: pair.targetId,
      amount: -take,
      kind: 'release',
      manual: false,
    });
  }
}

export interface SettleInput {
  targets: readonly AllocationTarget[];
  sources: readonly AllocationSource[];
  pairs: readonly AllocationPair[];
  /** Sources written in this same operation: their first allocations are `allocation`, not
   * `credit_applied`. */
  newSourceIds?: ReadonlySet<string>;
}

/**
 * P4: brings one account's allocations back to the invariants after any ledger change.
 * 1. A target allocated above `max(net, 0)` (amended down, voided) releases the excess, newest
 *    first.
 * 2. A source allocated above its capacity (voided) releases the excess, newest first.
 * 3. Every source with unallocated money, oldest first, covers open targets oldest first — so
 *    credit is applied at once to what is owed, and otherwise waits for the next charge.
 */
export function settle(input: SettleInput): NewAllocation[] {
  const pairs = input.pairs.map((pair) => ({ ...pair }));
  const out: NewAllocation[] = [];

  for (const target of input.targets) {
    const own = pairs.filter((pair) => pair.targetId === target.entryId);
    const allocated = own.reduce((sum, pair) => sum + pair.amount, 0n);
    const excess = allocated - max0(target.net);
    if (excess > 0n) releaseNewestFirst(own, excess, out);
  }
  for (const source of input.sources) {
    const own = pairs.filter((pair) => pair.sourceId === source.entryId);
    const allocated = own.reduce((sum, pair) => sum + pair.amount, 0n);
    const excess = allocated - max0(source.capacity);
    if (excess > 0n) releaseNewestFirst(own, excess, out);
  }

  const outstanding = outstandingByTarget(input.targets, pairs);
  const free = unallocatedBySource(input.sources, pairs);
  const targets = [...input.targets].sort(byAge);
  for (const source of [...input.sources].sort(byAge)) {
    let left = free.get(source.entryId) ?? 0n;
    for (const target of targets) {
      if (left <= 0n) break;
      const owed = outstanding.get(target.entryId) ?? 0n;
      const take = min(left, owed);
      if (take <= 0n) continue;
      outstanding.set(target.entryId, owed - take);
      left -= take;
      out.push({
        sourceId: source.entryId,
        targetId: target.entryId,
        amount: take,
        kind: input.newSourceIds?.has(source.entryId) ? 'allocation' : 'credit_applied',
        manual: false,
      });
    }
  }
  return out;
}

/**
 * P6: what a refund of `amount` releases from its payment: its unallocated part (credit) first,
 * then the remaining allocations proportionally, cents by largest remainder (ties: the newer
 * pair). `amount` must not exceed the payment's capacity; the caller has checked.
 */
export function refundReleases(input: {
  amount: bigint;
  capacity: bigint;
  pairs: readonly AllocationPair[];
}): { targetId: string; amount: bigint }[] {
  const live = input.pairs.filter((pair) => pair.amount > 0n);
  const allocated = live.reduce((sum, pair) => sum + pair.amount, 0n);
  const fromCredit = min(input.amount, max0(input.capacity - allocated));
  const rest = min(input.amount - fromCredit, allocated);
  if (rest <= 0n) return [];
  const shares = live.map((pair) => {
    const exact = rest * pair.amount;
    return {
      pair,
      cents: exact / allocated,
      remainder: exact % allocated,
    };
  });
  let left = rest - shares.reduce((sum, share) => sum + share.cents, 0n);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder !== b.remainder
      ? a.remainder > b.remainder
        ? -1
        : 1
      : b.pair.order - a.pair.order,
  );
  for (const share of byRemainder) {
    if (left <= 0n) break;
    if (share.cents >= share.pair.amount) continue;
    share.cents += 1n;
    left -= 1n;
  }
  return shares
    .filter((share) => share.cents > 0n)
    .map((share) => ({ targetId: share.pair.targetId, amount: share.cents }));
}
