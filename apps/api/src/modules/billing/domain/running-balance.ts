import type { LedgerEntryKind } from '@dcm/contracts';

/**
 * The running balance of an account (spec §Balance & payments, P16): the payment history's
 * _Remaining_ and the statement's balance column. A payment's Remaining is "charges dated on or
 * before it, less payments up to and including it" — so within a day every non-payment entry
 * comes before the payments. A voided payment and its void never happened as far as the running
 * balance goes (P7): they keep their place but add nothing. Pure; amounts in cents.
 */

const PAYMENT_KINDS: readonly LedgerEntryKind[] = ['payment', 'payment_refund', 'payment_void'];

export interface RunningEntry {
  id: string;
  kind: LedgerEntryKind;
  amount: bigint;
  date: string;
  createdAt: number;
  /** A voided payment's entry, or a `payment_void`. */
  voided: boolean;
}

export interface RunningLine<T extends RunningEntry> {
  entry: T;
  balance: bigint;
}

function rank(entry: RunningEntry): number {
  return PAYMENT_KINDS.includes(entry.kind) ? 1 : 0;
}

/** Oldest first, each with the balance after it; voided entries add nothing. */
export function runningBalance<T extends RunningEntry>(entries: readonly T[]): RunningLine<T>[] {
  const ordered = [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let balance = 0n;
  return ordered.map((entry) => {
    if (!entry.voided) balance += entry.amount;
    return { entry, balance };
  });
}
