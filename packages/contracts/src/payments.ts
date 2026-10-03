import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { balanceAmountSchema, ledgerEntryKindSchema, paymentMethodSchema } from './billing.js';
import {
  blankToUndefined,
  currencySchema,
  cursorPageQuerySchema,
  cursorPageSchema,
  decimalAmountSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  notFutureDateSchema,
  optionalText,
} from './common.js';

/**
 * Feature 5 (spec `2026-10-02-payments-design.md`, ADR-0027–0029): payments are transactions on
 * the patient's account. Allocations — which charges a payment, a write-off or applied credit
 * covered — are stored but derived; they never limit what can be paid.
 */

/** `payment` takes money; `refund` gives some back; `void` cancels a mis-entry entirely. */
export const PAYMENT_KINDS = ['payment', 'refund', 'void'] as const;
export const paymentKindSchema = z.enum(PAYMENT_KINDS);
export type PaymentKind = z.infer<typeof paymentKindSchema>;

/** Receivables aging on the unpaid remainder of each charge, by days since its date (B10). */
export const AGING_BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export const agingBucketSchema = z.enum(AGING_BUCKETS);
export type AgingBucket = z.infer<typeof agingBucketSchema>;

const RECEIPT_NUMBER_PAD = 6;

/** `RCT-000123`: the per-tenant receipt sequence, shared by a household's rows (P10). */
export function formatReceiptNumber(value: number): string {
  return `RCT-${String(value).padStart(RECEIPT_NUMBER_PAD, '0')}`;
}

/** `INV-000123`: a visit's invoice carries the visit number's digits (P10). */
export function formatInvoiceNumber(visitNumber: number): string {
  return `INV-${String(visitNumber).padStart(RECEIPT_NUMBER_PAD, '0')}`;
}

/** `EST-P-000042-20261002`: a plan quote is not stored; its number is the patient and the day. */
export function formatQuoteNumber(patientNumber: string, date: string): string {
  return `EST-${patientNumber}-${date.replaceAll('-', '')}`;
}

const positiveAmountSchema = decimalAmountSchema.refine(
  (amount) => Number(amount) > 0,
  'Must be greater than zero',
);

const REFERENCE_MAX = 80;
const PAYMENT_NOTE_MAX = 200;

/**
 * `POST /billing/payments` and `/preview`. `scope = household` pays every account of the payer's
 * household (B5). `contextVisitId` puts that visit's charge first (opened from a visit);
 * `targetEntryId` is the advanced "Apply to a specific visit" pick (B4), capped at its
 * outstanding. `payerContactId` omitted → the patient's primary billing contact; `null` → the
 * patient pays.
 */
export const paymentInputSchema = z.object({
  patientId: idSchema,
  amount: positiveAmountSchema,
  method: paymentMethodSchema,
  paidAt: notFutureDateSchema(),
  reference: optionalText(REFERENCE_MAX),
  note: optionalText(PAYMENT_NOTE_MAX),
  payerContactId: idSchema.nullable().optional(),
  scope: z.enum(['patient', 'household']).default('patient'),
  contextVisitId: idSchema.optional(),
  targetEntryId: idSchema.optional(),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;
export type PaymentRequest = z.input<typeof paymentInputSchema>;

/** What a charge (an allocation target) is, for labels: a visit, an opening balance or a debit
 * adjustment. */
export const chargeRefSchema = z.object({
  entryId: idSchema,
  patientId: idSchema,
  kind: ledgerEntryKindSchema,
  visitId: idSchema.nullable(),
  visitNumber: z.number().int().positive().nullable(),
  date: isoDateSchema,
});
export type ChargeRef = z.infer<typeof chargeRefSchema>;

export const allocationLineSchema = chargeRefSchema.extend({ amount: balanceAmountSchema });
export type AllocationLine = z.infer<typeof allocationLineSchema>;

/**
 * The dry run (and the outcome) of a payment: the cap (`outstanding` across the paid accounts),
 * what each charge would absorb, and what stays owing. `error` is set when the amount can't be
 * taken (over the cap, or nothing owed).
 */
export const paymentPreviewSchema = z.object({
  currency: currencySchema,
  outstanding: balanceAmountSchema,
  remaining: balanceAmountSchema,
  allocations: z.array(allocationLineSchema),
  error: z.enum(['payment.over_outstanding', 'payment.nothing_outstanding']).nullable(),
});
export type PaymentPreview = z.infer<typeof paymentPreviewSchema>;

export const recordPaymentResultSchema = z.object({
  receiptNumber: z.number().int().positive(),
  /** One per paid account (several for a household). */
  paymentIds: z.array(idSchema).min(1),
  householdGroupId: idSchema.nullable(),
  amount: balanceAmountSchema,
  currency: currencySchema,
  /** What the paid accounts still owe after it. */
  remaining: balanceAmountSchema,
  allocations: z.array(allocationLineSchema),
});
export type RecordPaymentResult = z.infer<typeof recordPaymentResultSchema>;

/** `POST /billing/payments/:id/refund`: amount ≤ what is left of the payment (P6). */
export const refundInputSchema = z.object({
  amount: positiveAmountSchema,
  reason: reasonSchema,
  method: paymentMethodSchema.optional(),
  refundedAt: notFutureDateSchema().optional(),
});
export type RefundInput = z.infer<typeof refundInputSchema>;

/** `POST /billing/payments/:id/void`: a mis-entry; the whole receipt is cancelled (P7). */
export const voidPaymentInputSchema = z.object({ reason: reasonSchema });
export type VoidPaymentInput = z.infer<typeof voidPaymentInputSchema>;

/** A refund or void: the rows it wrote (one per paid account for a household void). */
export const paymentWriteResultSchema = z.object({ ids: z.array(idSchema).min(1) });
export type PaymentWriteResult = z.infer<typeof paymentWriteResultSchema>;

export const PAYMENT_RANGES = ['7d', '30d', '90d', 'all'] as const;
export const paymentRangeSchema = z.enum(PAYMENT_RANGES);
export type PaymentRange = z.infer<typeof paymentRangeSchema>;

const searchText = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((value) => (value ? value : undefined));

/** The Transactions tab filters (shared by the list and its CSV export). */
export const transactionFiltersSchema = z.object({
  range: blankToUndefined(paymentRangeSchema.default('30d')),
  method: blankToUndefined(paymentMethodSchema.optional()),
  kind: blankToUndefined(paymentKindSchema.optional()),
  /** A patient (name, number, phone), a receipt (`RCT-12` or `12`) or a visit number (`V-12`). */
  q: searchText,
  patientId: blankToUndefined(idSchema.optional()),
});
export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;

export const transactionQuerySchema = transactionFiltersSchema.extend(cursorPageQuerySchema.shape);
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

export const transactionExportQuerySchema = transactionFiltersSchema.extend({
  lang: blankToUndefined(z.enum(['en', 'ar', 'fr']).optional()),
});
export type TransactionExportQuery = z.infer<typeof transactionExportQuerySchema>;

export const patientRefSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  displayNumber: z.string(),
});
export type PatientRef = z.infer<typeof patientRefSchema>;

/** One row of Transactions and of a patient's payment history. */
export const transactionSchema = z.object({
  id: idSchema,
  kind: paymentKindSchema,
  receiptNumber: z.number().int().positive(),
  paidAt: isoDateSchema,
  patient: patientRefSchema,
  householdGroupId: idSchema.nullable(),
  method: paymentMethodSchema,
  amount: balanceAmountSchema,
  currency: currencySchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  reason: z.string().nullable(),
  /** The payment a refund/void reverses. */
  reversesPaymentId: idSchema.nullable(),
  /** A payment that left the account owing (the "· partial" pill). */
  partial: z.boolean(),
  /** For a payment: Σ its refunds; whether it was voided. */
  refunded: balanceAmountSchema,
  voided: z.boolean(),
  /** The visits a payment is (still) allocated to, by visit number. */
  visits: z.array(z.object({ visitId: idSchema, visitNumber: z.number().int().positive() })),
  recordedBy: z.object({ userId: idSchema, name: z.string().nullable() }),
  recordedAt: isoDateTimeSchema,
});
export type Transaction = z.infer<typeof transactionSchema>;

export const transactionPageSchema = cursorPageSchema(transactionSchema);
export type TransactionPage = z.infer<typeof transactionPageSchema>;

/** `GET /billing/aging`: the Payments KPI cards and the aging bar, in the tenant currency. */
export const receivablesSchema = z.object({
  currency: currencySchema,
  collected30d: balanceAmountSchema,
  refunds30d: balanceAmountSchema,
  outstanding: balanceAmountSchema,
  buckets: z.array(
    z.object({
      bucket: agingBucketSchema,
      amount: balanceAmountSchema,
      patients: z.number().int().nonnegative(),
    }),
  ),
});
export type Receivables = z.infer<typeof receivablesSchema>;

export const payerSchema = z.object({
  /** `null` = the patient pays. */
  contactId: idSchema.nullable(),
  name: z.string(),
  /** The payer's own patient record, when they are a patient. */
  patientId: idSchema.nullable(),
});
export type Payer = z.infer<typeof payerSchema>;

/** Outstanding by patient, or by payer: a family under its primary billing contact (feature 5). */
export const OUTSTANDING_GROUPS = ['patient', 'payer'] as const;
export type OutstandingGroup = (typeof OUTSTANDING_GROUPS)[number];

export const outstandingQuerySchema = cursorPageQuerySchema.extend({
  group: blankToUndefined(z.enum(OUTSTANDING_GROUPS).default('patient')),
  bucket: blankToUndefined(agingBucketSchema.optional()),
  q: searchText,
});
export type OutstandingQuery = z.infer<typeof outstandingQuerySchema>;

/**
 * A patient owing (or, grouped by payer, a family owing), with the age of the oldest unpaid
 * charge (its bucket, P13). `patient` is the member with the oldest charge; `members` lists every
 * owing member (one when grouped by patient); `payer` is the primary billing contact, null when
 * the patient pays. `payFor` is the patient to open the payment panel with (a member the payer
 * bills, so a family payment can take the whole household).
 */
export const outstandingItemSchema = z.object({
  patient: patientRefSchema,
  payer: payerSchema.nullable(),
  members: z.array(patientRefSchema).min(1),
  payFor: idSchema,
  oldestUnpaid: isoDateSchema,
  bucket: agingBucketSchema,
  openVisits: z.number().int().nonnegative(),
  balance: balanceAmountSchema,
  currency: currencySchema,
});
export type OutstandingItem = z.infer<typeof outstandingItemSchema>;

export const outstandingPageSchema = cursorPageSchema(outstandingItemSchema);
export type OutstandingPage = z.infer<typeof outstandingPageSchema>;

/** An open charge with what is allocated to it (the B4 picker, the balance card). */
export const openChargeSchema = chargeRefSchema.extend({
  charged: balanceAmountSchema,
  paid: balanceAmountSchema,
  outstanding: balanceAmountSchema,
});
export type OpenCharge = z.infer<typeof openChargeSchema>;

/** One payment-history row: a payment with its running Remaining (spec §Balance & payments). */
export const paymentHistoryItemSchema = transactionSchema.extend({
  allocations: z.array(allocationLineSchema),
  /** Charges dated on or before it, less payments up to and including it. */
  remaining: balanceAmountSchema,
});
export type PaymentHistoryItem = z.infer<typeof paymentHistoryItemSchema>;

/** The payer's household (B5, Q4): their own account if they are a patient, and every account
 * they are the billing contact for; owing ones count toward `total`. */
export const householdSchema = z.object({
  payer: payerSchema,
  patients: z.array(patientRefSchema.extend({ balance: balanceAmountSchema })),
  total: balanceAmountSchema,
});
export type Household = z.infer<typeof householdSchema>;

/** `GET /billing/patients/:id/account`: the Balance & payments tab and the payment panel. */
export const patientAccountSchema = z.object({
  patientId: idSchema,
  currency: currencySchema,
  /** Σ ledger in the tenant currency; negative = credit. */
  balance: balanceAmountSchema,
  credit: balanceAmountSchema,
  lastVisit: z
    .object({
      visitId: idSchema,
      visitNumber: z.number().int().positive(),
      date: isoDateSchema,
      total: balanceAmountSchema,
      paid: balanceAmountSchema,
      outstanding: balanceAmountSchema,
    })
    .nullable(),
  previousOutstanding: balanceAmountSchema,
  openCharges: z.array(openChargeSchema),
  /** The default payer (the primary billing contact) and the patient's other billing contacts. */
  payer: payerSchema,
  payers: z.array(payerSchema),
  /** Set when the default payer's household has more than this one account owing. */
  household: householdSchema.nullable(),
  /** This patient as a payer: the contact that is them, when they bill for anyone (a parent). */
  payerFor: payerSchema.nullable(),
  history: z.array(paymentHistoryItemSchema),
});
export type PatientAccount = z.infer<typeof patientAccountSchema>;

/** `GET /billing/patients/:id/account?payerContactId=`: the payer the panel opens with. */
export const payerQuerySchema = z.object({
  payerContactId: blankToUndefined(idSchema.optional()),
});
export type PayerQuery = z.infer<typeof payerQuerySchema>;

/** One account of a family: its balance and how old its unpaid money is. */
export const familyMemberSchema = patientRefSchema.extend({
  balance: balanceAmountSchema,
  oldestUnpaid: isoDateSchema.nullable(),
  openVisits: z.number().int().nonnegative(),
  /** The payer's own record (a parent who is also a patient). */
  isPayer: z.boolean(),
});
export type FamilyMember = z.infer<typeof familyMemberSchema>;

/**
 * `GET /billing/contacts/:id/family`: what a billing contact's family owes (ADR-0028's
 * household seen from the payer): the payer's own record if they are a patient, and every
 * non-archived patient they are a billing contact for. `total` sums the owing balances;
 * `payFor` is a member to open the payment panel with (null when the contact bills nobody).
 */
export const familySchema = z.object({
  payer: payerSchema,
  currency: currencySchema,
  members: z.array(familyMemberSchema),
  total: balanceAmountSchema,
  payFor: idSchema.nullable(),
});
export type Family = z.infer<typeof familySchema>;

/** `GET /billing/payments/:id/receipt`: the receipt (a household's rows under one number). */
export const receiptSchema = z.object({
  receiptNumber: z.number().int().positive(),
  paidAt: isoDateSchema,
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  currency: currencySchema,
  total: balanceAmountSchema,
  voided: z.object({ on: isoDateSchema, reason: z.string() }).nullable(),
  refunds: z.array(
    z.object({ on: isoDateSchema, amount: balanceAmountSchema, reason: z.string() }),
  ),
  payer: payerSchema,
  recordedBy: z.string().nullable(),
  rows: z.array(
    z.object({
      paymentId: idSchema,
      patient: patientRefSchema,
      amount: balanceAmountSchema,
      allocations: z.array(allocationLineSchema),
      /** The account's balance right after this payment. */
      balanceAfter: balanceAmountSchema,
    }),
  ),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const STATEMENT_LINE_KINDS = [
  'opening_balance',
  'charge',
  'charge_correction',
  'adjustment',
  'payment',
  'refund',
] as const;

/** `GET /billing/patients/:id/statement`: every entry (voided payments left out), running. */
export const statementSchema = z.object({
  patient: patientRefSchema,
  billingContact: payerSchema.nullable(),
  currency: currencySchema,
  lines: z.array(
    z.object({
      date: isoDateSchema,
      kind: z.enum(STATEMENT_LINE_KINDS),
      visitNumber: z.number().int().positive().nullable(),
      receiptNumber: z.number().int().positive().nullable(),
      method: paymentMethodSchema.nullable(),
      note: z.string().nullable(),
      /** Signed: positive = owed. */
      amount: balanceAmountSchema,
      balance: balanceAmountSchema,
    }),
  ),
  charged: balanceAmountSchema,
  paid: balanceAmountSchema,
  outstanding: balanceAmountSchema,
});
export type Statement = z.infer<typeof statementSchema>;

/** `GET /billing/contacts/:id/family/statement`: one statement per member, and the family total. */
export const familyStatementSchema = z.object({
  payer: payerSchema,
  currency: currencySchema,
  members: z.array(statementSchema),
  total: balanceAmountSchema,
});
export type FamilyStatement = z.infer<typeof familyStatementSchema>;
