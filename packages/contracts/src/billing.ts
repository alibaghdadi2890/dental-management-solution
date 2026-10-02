import { z } from 'zod';
import {
  aggregateAmountSchema,
  blankToUndefined,
  commaSeparatedIds,
  currencySchema,
  decimalAmountSchema,
  idSchema,
  notFutureDateSchema,
  optionalText,
} from './common.js';
import { reasonSchema } from './audit.js';
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
 */
export const LEDGER_ENTRY_KINDS = [
  'opening_balance',
  'adjustment',
  'visit_charge',
  'visit_charge_adjustment',
  'visit_charge_reversal',
] as const;
export const ledgerEntryKindSchema = z.enum(LEDGER_ENTRY_KINDS);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindSchema>;

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

/** No UI in this feature; a building block for corrections and feature 6 import. */
export const adjustmentInputSchema = z.object({
  amount: decimalAmountSchema.refine((amount) => Number(amount) !== 0, 'Must not be zero'),
  effectiveDate: notFutureDateSchema(),
  reason: reasonSchema,
  note: optionalText(LEDGER_NOTE_MAX),
});
export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;

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

/** Result of `POST /billing/opening-balances`. */
export const openingBalanceResultSchema = z.object({
  patient: patientSchema,
  balance: patientBalanceSchema,
});
export type OpeningBalanceResult = z.infer<typeof openingBalanceResultSchema>;

/**
 * `GET /billing/visits/:visitId/summary` (spec W2): a completed visit's figures, all in the visit
 * currency and read from the ledger. _This visit_ is its `visit_charge` (0 when the total was 0,
 * W20); nothing is paid yet (payments are feature 5); _Previous_ is the balance less the charge
 * (negative for a credit); the total is the balance. Balances in other currencies are left out.
 */
export const visitBalancesQuerySchema = z.object({
  visitIds: commaSeparatedIds(MAX_COMMA_SEPARATED_IDS),
});
export type VisitBalancesQuery = z.infer<typeof visitBalancesQuerySchema>;

/**
 * `GET /billing/visits/balances` (4b): per visit, in its currency, `charged` = Σ its visit
 * entries (charge, adjustments, reversal), `paid` = its payment allocations (none before feature
 * 5), `outstanding` = charged − paid. A visit without entries (live, or a zero total) is absent.
 */
export const visitBalanceSchema = z.object({
  visitId: idSchema,
  currency: currencySchema,
  charged: balanceAmountSchema,
  paid: balanceAmountSchema,
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
});
export type VisitFinancialSummary = z.infer<typeof visitFinancialSummarySchema>;
