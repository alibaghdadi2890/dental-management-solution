import {
  ADJUSTMENT_NOTE_MIN,
  type AdjustmentReason,
  type AdjustmentRequest,
  fromCents,
  toCents,
} from '@dcm/contracts';
import { parseAmount } from '@/lib/amount';

/**
 * The Adjust balance panel's state and rules (feature 7, H4). The direction is worded the
 * clinic's way and decides the sign: "owes less" is a negative adjustment (write-off, courtesy,
 * correction), "owes more" a positive one (a charge without a visit, correction).
 */
export type AdjustDirection = 'less' | 'more';

export interface AdjustDraft {
  direction: AdjustDirection;
  amountText: string;
  /** Empty until one is chosen: a reason is required. */
  reason: AdjustmentReason | '';
  note: string;
  effectiveDate: string;
}

export function initialAdjustDraft(today: string): AdjustDraft {
  return { direction: 'less', amountText: '', reason: '', note: '', effectiveDate: today };
}

export type AdjustAmountProblem = 'invalid' | 'zero';

export interface AdjustStatus {
  /** The typed amount in cents (unsigned), or null while empty or unreadable. */
  amount: bigint | null;
  problem: AdjustAmountProblem | null;
  /** The balance once the adjustment is saved; null while the amount is empty or invalid. */
  after: bigint | null;
  /** "Other" was chosen and the note doesn't say why yet. */
  noteMissing: boolean;
  /** Everything needed to save is there. */
  ready: boolean;
}

/** What the Full chip fills: the whole outstanding, when the patient owes anything. */
export function fullAmount(balance: bigint): bigint {
  return balance > 0n ? balance : 0n;
}

export function adjustStatus(
  draft: AdjustDraft,
  balance: bigint,
  locale: string,
  today: string,
): AdjustStatus {
  const noteMissing = draft.reason === 'other' && draft.note.trim().length < ADJUSTMENT_NOTE_MIN;
  const text = draft.amountText.trim();
  const parsed = text === '' ? null : parseAmount(text, locale);
  const amount = parsed === null ? null : toCents(parsed);
  let problem: AdjustAmountProblem | null = null;
  if (text !== '' && amount === null) problem = 'invalid';
  else if (amount !== null && amount <= 0n) problem = 'zero';
  const usable = amount !== null && problem === null ? amount : null;
  const dated = draft.effectiveDate !== '' && draft.effectiveDate <= today;
  return {
    amount: usable,
    problem,
    after: usable === null ? null : balance + (draft.direction === 'less' ? -usable : usable),
    noteMissing,
    ready: usable !== null && draft.reason !== '' && !noteMissing && dated,
  };
}

/** The request for a ready draft: the direction becomes the sign. */
export function adjustRequest(draft: AdjustDraft, amount: bigint): AdjustmentRequest | null {
  if (draft.reason === '') return null;
  const note = draft.note.trim();
  return {
    amount: fromCents(draft.direction === 'less' ? -amount : amount),
    effectiveDate: draft.effectiveDate,
    reason: draft.reason,
    ...(note === '' ? {} : { note }),
  };
}
