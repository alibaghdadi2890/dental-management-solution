import { z } from 'zod';
import {
  aggregateAmountSchema,
  blankToUndefined,
  commaSeparatedIds,
  currencySchema,
  decimalAmountSchema,
  idSchema,
  isoDateSchema,
  notFutureDateSchema,
  optionalText,
} from './common.js';
import { patientCreateSchema, patientListQuerySchema, patientSchema } from './patients.js';
import { VISIT_LIST_TABS, visitFiltersSchema } from './visit-list.js';

/**
 * `billing` (feature 3, ADR-0017): opening balances and adjustments on the patient ledger, and
 * the patient views/export that need a balance. `billing` depends on `patients`; `patients` never
 * imports `billing` (design Q1, Q4, Q5).
 */

/**
 * `visit_charge` (feature 4a, ADR-0024): posted when a visit completes, in that transaction.
 * `visit_charge_adjustment` / `visit_charge_reversal` (feature 4b): an amendment's difference and
 * a void's reversal, posted in the amend/void transaction. The three are the visit kinds.
 * `payment` (negative), `payment_refund` and `payment_void` (positive): feature 5, one per
 * `payments` row (ADR-0027).
 */
export const LEDGER_ENTRY_KINDS = [
  'opening_balance',
  'adjustment',
  'visit_charge',
  'visit_charge_adjustment',
  'visit_charge_reversal',
  'payment',
  'payment_refund',
  'payment_void',
] as const;
export const ledgerEntryKindSchema = z.enum(LEDGER_ENTRY_KINDS);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindSchema>;

/** How a payment was taken (feature 5); Insurance is a method, not a claim. */
export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'insurance'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** The entries that carry a `visit_id`; their sum is what the visit charges now. */
export const VISIT_LEDGER_KINDS = [
  'visit_charge',
  'visit_charge_adjustment',
  'visit_charge_reversal',
] as const satisfies LedgerEntryKind[];

/** Max length of a ledger entry's free-text note (opening balance or adjustment). */
const LEDGER_NOTE_MAX = 200;

/** A patient carried over from a previous system starts with this on create (design Q1). */
export const openingBalanceInputSchema = z.object({
  amount: decimalAmountSchema.refine((amount) => Number(amount) > 0, 'Must be greater than zero'),
  asOf: notFutureDateSchema(),
  note: optionalText(LEDGER_NOTE_MAX),
});
export type OpeningBalanceInput = z.infer<typeof openingBalanceInputSchema>;

/**
 * `POST /billing/opening-balances`: one transaction, `PatientsService.create` then the entry. The
 * patient is a full create (addendum C4): its contacts are linked in the same transaction.
 */
export const createWithOpeningBalanceSchema = z.object({
  patient: patientCreateSchema,
  openingBalance: openingBalanceInputSchema,
});
export type CreateWithOpeningBalance = z.infer<typeof createWithOpeningBalanceSchema>;
/** What a client sends (defaults such as `contacts: []` may be left out). */
export type CreateWithOpeningBalanceInput = z.input<typeof createWithOpeningBalanceSchema>;

/**
 * Why a balance was adjusted (feature 7, H4). Stored as text in the entry's `reason`; entries
 * recorded before the list existed hold free text there, so reads type it as a string.
 */
export const ADJUSTMENT_REASONS = [
  'write_off',
  'courtesy',
  'opening_balance_correction',
  'charge_without_visit',
  'other',
] as const;
export const adjustmentReasonSchema = z.enum(ADJUSTMENT_REASONS);
export type AdjustmentReason = z.infer<typeof adjustmentReasonSchema>;

/** The shortest note that explains an "other" adjustment: the rule of every reason dialog. */
export const ADJUSTMENT_NOTE_MIN = 3;

/**
 * `POST /billing/patients/:id/adjustments`: a signed, reasoned, dated correction of what the
 * patient owes: negative = owes less (write-off, courtesy, correction), positive = owes more
 * (a charge without a visit, correction). "Other" needs the note to say why.
 */
export const adjustmentInputSchema = z
  .object({
    amount: decimalAmountSchema.refine((amount) => Number(amount) !== 0, 'Must not be zero'),
    effectiveDate: notFutureDateSchema(),
    reason: adjustmentReasonSchema,
    note: optionalText(LEDGER_NOTE_MAX),
  })
  .superRefine((input, context) => {
    if (input.reason === 'other' && (input.note ?? '').length < ADJUSTMENT_NOTE_MIN) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: `Say why in at least ${String(ADJUSTMENT_NOTE_MIN)} characters`,
      });
    }
  });
export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
/** What a client sends (the note may be left out). */
export type AdjustmentRequest = z.input<typeof adjustmentInputSchema>;

/** A ledger balance's amount: a sum of ledger entries, so `common.ts`'s `aggregateAmountSchema`
 * (not `decimalAmountSchema`, which is for one input bounded by a `numeric(12,2)` column). */
export const balanceAmountSchema = aggregateAmountSchema;

/** One currency's balance; `moneySchema` is for single amounts (inputs, prices). */
export const balanceMoneySchema = z.object({
  amount: balanceAmountSchema,
  currency: currencySchema,
});
export type BalanceMoney = z.infer<typeof balanceMoneySchema>;

/**
 * Balance = Σ amount per currency (design Q13); a patient without entries gets `balances: []`.
 * `charged` is Σ `visit_charge` per currency (the Record's _Lifetime billed_, spec W8), by the
 * same rules: non-zero currencies only, ordered by code.
 */
export const patientBalanceSchema = z.object({
  patientId: idSchema,
  balances: z.array(balanceMoneySchema),
  charged: z.array(balanceMoneySchema),
});
export type PatientBalance = z.infer<typeof patientBalanceSchema>;

export const patientBalancesSchema = z.array(patientBalanceSchema);

/** Shared by `balancesQuerySchema.patientIds` and `patientExportQuerySchema.ids`. */
const MAX_COMMA_SEPARATED_IDS = 100;

export const balancesQuerySchema = z.object({
  patientIds: commaSeparatedIds(MAX_COMMA_SEPARATED_IDS),
});
export type BalancesQuery = z.infer<typeof balancesQuerySchema>;

/** The languages the CSV export's header row and values come in. */
export const EXPORT_LANGUAGES = ['en', 'ar', 'fr'] as const;
export const exportLanguageSchema = z.enum(EXPORT_LANGUAGES);
export type ExportLanguage = z.infer<typeof exportLanguageSchema>;

/**
 * `GET /billing/patients/export`: the list query (paging dropped) plus an optional id filter and
 * an optional `lang` (the SPA's UI language), which overrides `Accept-Language`.
 */
export const patientExportQuerySchema = patientListQuerySchema
  .omit({ page: true, size: true })
  .extend({
    ids: commaSeparatedIds(MAX_COMMA_SEPARATED_IDS).optional(),
    lang: blankToUndefined(exportLanguageSchema.optional()),
  });
export type PatientExportQuery = z.infer<typeof patientExportQuerySchema>;

/** `GET /billing/patients/owing-count`: active patients owing in any currency (the tab chip). */
export const owingCountSchema = z.object({ count: z.number().int().nonnegative() });
export type OwingCount = z.infer<typeof owingCountSchema>;

/**
 * `GET /billing/currency-lock`: the tenant currency is locked once any ledger entry exists
 * (feature 7, H6); `currency` is the one it is locked in.
 */
export const currencyLockSchema = z.object({ locked: z.boolean(), currency: currencySchema });
export type CurrencyLock = z.infer<typeof currencyLockSchema>;

/** Result of `POST /billing/opening-balances`. */
export const openingBalanceResultSchema = z.object({
  patient: patientSchema,
  balance: patientBalanceSchema,
});
export type OpeningBalanceResult = z.infer<typeof openingBalanceResultSchema>;

/**
 * `GET /billing/visits/:visitId/summary` (spec W2): a completed visit's figures, all in the visit
 * currency and read from the ledger. _This visit_ is its `visit_charge` (0 when the total was 0,
 * W20); _paid_ is what is allocated to it (feature 5); _Previous_ is the balance less this
 * visit's outstanding (negative for a credit); the total is the balance. Balances in other
 * currencies are left out. `payments` lists the payments allocated to it, for the invoice.
 */
export const visitBalancesQuerySchema = z.object({
  visitIds: commaSeparatedIds(MAX_COMMA_SEPARATED_IDS),
});
export type VisitBalancesQuery = z.infer<typeof visitBalancesQuerySchema>;

/**
 * `GET /billing/visits/balances` (4b): per visit, in its currency, `charged` = Σ its visit
 * entries (charge, adjustments, reversal), `paid` = what is allocated to it (payments, applied
 * credit, write-offs; feature 5), `outstanding` = charged − paid. A visit without entries (live, or a zero total) is absent.
 */
export const visitBalanceSchema = z.object({
  visitId: idSchema,
  currency: currencySchema,
  charged: balanceAmountSchema,
  paid: balanceAmountSchema,
  /** The part of `paid` that payments cover: what blocks a void (P8); the rest is write-offs. */
  paidByPayments: balanceAmountSchema,
  outstanding: balanceAmountSchema,
});
export type VisitBalance = z.infer<typeof visitBalanceSchema>;
export const visitBalancesSchema = z.array(visitBalanceSchema);

/** `GET /billing/visits/unpaid/summary`: `count`/`billed` follow the filters, `tabCount` (the
 * Unpaid tab chip) ignores them. */
export const unpaidVisitsSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  billed: z.array(balanceMoneySchema),
  tabCount: z.number().int().nonnegative(),
});
export type UnpaidVisitsSummary = z.infer<typeof unpaidVisitsSummarySchema>;

/** `GET /billing/visits/export`: the list filters (any tab, *Unpaid* included) and a language. */
export const visitExportQuerySchema = visitFiltersSchema.extend({
  tab: blankToUndefined(z.enum([...VISIT_LIST_TABS, 'unpaid']).default('all')),
  lang: blankToUndefined(exportLanguageSchema.optional()),
});
export type VisitExportQuery = z.infer<typeof visitExportQuerySchema>;

export const visitFinancialSummarySchema = z.object({
  visitId: idSchema,
  currency: currencySchema,
  visit: z.object({
    total: balanceAmountSchema,
    paid: balanceAmountSchema,
    outstanding: balanceAmountSchema,
  }),
  previous: balanceAmountSchema,
  totalOutstanding: balanceAmountSchema,
  payments: z.array(
    z.object({
      paymentId: idSchema,
      receiptNumber: z.number().int().positive(),
      paidAt: isoDateSchema,
      method: paymentMethodSchema,
      amount: balanceAmountSchema,
    }),
  ),
});
export type VisitFinancialSummary = z.infer<typeof visitFinancialSummarySchema>;
