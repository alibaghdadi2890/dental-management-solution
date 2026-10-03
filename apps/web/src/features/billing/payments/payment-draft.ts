import {
  fromCents,
  type PatientAccount,
  type PaymentMethod,
  type PaymentRequest,
  toCents,
} from '@dcm/contracts';
import { parseAmount } from '@/lib/amount';

/**
 * The Record payment panel's state and rules (workspace spec §Record Payment, feature 5 B2–B5):
 * the amount starts empty, may be partial, and may not exceed what the paid account(s) owe.
 */
export interface PaymentDraft {
  amountText: string;
  method: PaymentMethod;
  paidAt: string;
  reference: string;
  /** `undefined` = the default payer (the primary billing contact, else the patient). */
  payerContactId: string | null | undefined;
  /** B5: pay every owing account of the default payer's household. */
  household: boolean;
  /** B4: the charge to cover first ("Apply to a specific visit"). */
  targetEntryId: string | undefined;
}

export function initialDraft(
  today: string,
  targetEntryId?: string,
  household = false,
): PaymentDraft {
  return {
    amountText: '',
    method: 'cash',
    paidAt: today,
    reference: '',
    payerContactId: undefined,
    household,
    targetEntryId,
  };
}

export type AmountProblem = 'invalid' | 'zero' | 'over';

export interface DraftStatus {
  /** The typed amount in cents, or null while empty or unreadable. */
  amount: bigint | null;
  /** What may be paid: the patient's outstanding, or the household's. */
  cap: bigint;
  problem: AmountProblem | null;
  /** Outstanding after this payment; null while the amount is empty or invalid. */
  remaining: bigint | null;
  /** The amount clears everything owed ("Record full payment"). */
  full: boolean;
}

/** The household applies only with the default payer, whose household the account describes. */
export function paysHousehold(draft: PaymentDraft, account: PatientAccount): boolean {
  return draft.household && draft.payerContactId === undefined && account.household !== null;
}

export function capOf(draft: PaymentDraft, account: PatientAccount): bigint {
  if (paysHousehold(draft, account) && account.household) {
    return toCents(account.household.total);
  }
  return account.openCharges.reduce((total, charge) => total + toCents(charge.outstanding), 0n);
}

export function statusOf(
  draft: PaymentDraft,
  account: PatientAccount,
  locale: string,
): DraftStatus {
  const cap = capOf(draft, account);
  const text = draft.amountText.trim();
  if (text === '') return { amount: null, cap, problem: null, remaining: null, full: false };
  const parsed = parseAmount(text, locale);
  if (parsed === null)
    return { amount: null, cap, problem: 'invalid', remaining: null, full: false };
  const amount = toCents(parsed);
  if (amount <= 0n) return { amount, cap, problem: 'zero', remaining: null, full: false };
  if (amount > cap) return { amount, cap, problem: 'over', remaining: null, full: false };
  return { amount, cap, problem: null, remaining: cap - amount, full: amount === cap };
}

/** Half of `cap`, rounded down to the cent (the "Half" chip). */
export function halfOf(cap: bigint): string {
  return fromCents(cap / 2n);
}

/** The request for a valid amount: patient or household, the payer, the context or chosen charge. */
export function requestOf(
  draft: PaymentDraft,
  account: PatientAccount,
  amount: bigint,
  context: {
    patientId: string;
    contextVisitId?: string | undefined;
    /** The payer the panel was opened for (`undefined` draft payer = this one). */
    payerContactId?: string | undefined;
  },
): PaymentRequest {
  const household = paysHousehold(draft, account);
  const reference = draft.reference.trim();
  return {
    patientId: context.patientId,
    amount: fromCents(amount),
    method: draft.method,
    paidAt: draft.paidAt,
    scope: household ? 'household' : 'patient',
    ...(reference ? { reference } : {}),
    ...(draft.payerContactId !== undefined
      ? { payerContactId: draft.payerContactId }
      : context.payerContactId
        ? { payerContactId: context.payerContactId }
        : {}),
    ...(context.contextVisitId ? { contextVisitId: context.contextVisitId } : {}),
    ...(!household && draft.targetEntryId ? { targetEntryId: draft.targetEntryId } : {}),
  };
}
