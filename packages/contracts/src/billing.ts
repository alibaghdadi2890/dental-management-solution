import { z } from 'zod';
import {
  blankToUndefined,
  currencySchema,
  decimalAmountSchema,
  idSchema,
  notFutureDateSchema,
  optionalText,
} from './common.js';
import { reasonSchema } from './audit.js';
import { patientCreateSchema, patientListQuerySchema, patientSchema } from './patients.js';

/**
 * `billing` (feature 3, ADR-0017): opening balances and adjustments on the patient ledger, and
 * the patient views/export that need a balance. `billing` depends on `patients`; `patients` never
 * imports `billing` (design Q1, Q4, Q5).
 */

export const LEDGER_ENTRY_KINDS = ['opening_balance', 'adjustment'] as const;
export const ledgerEntryKindSchema = z.enum(LEDGER_ENTRY_KINDS);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindSchema>;

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

/**
 * An aggregate amount (a sum of ledger entries). `decimalAmountSchema` is bounded by one
 * `numeric(12,2)` column and is for inputs; a sum can exceed 10 integer digits. Always exactly
 * two decimals, as the server formats it.
 */
export const balanceAmountSchema = z
  .string()
  .regex(/^-?\d{1,18}\.\d{2}$/, 'Expected a decimal amount with exactly 2 decimals');

/** One currency's balance; `moneySchema` is for single amounts (inputs, prices). */
export const balanceMoneySchema = z.object({
  amount: balanceAmountSchema,
  currency: currencySchema,
});
export type BalanceMoney = z.infer<typeof balanceMoneySchema>;

/** Balance = Σ amount per currency (design Q13); a patient without entries gets `balances: []`. */
export const patientBalanceSchema = z.object({
  patientId: idSchema,
  balances: z.array(balanceMoneySchema),
});
export type PatientBalance = z.infer<typeof patientBalanceSchema>;

export const patientBalancesSchema = z.array(patientBalanceSchema);

/** Shared by `balancesQuerySchema.patientIds` and `patientExportQuerySchema.ids`. */
const MAX_COMMA_SEPARATED_IDS = 100;

/** Splits a comma-separated id list, trims each, drops empties and de-dupes (order preserved). */
function commaSeparatedIds(max: number) {
  return z
    .string()
    .min(1)
    .transform((value) => {
      const ids = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      return Array.from(new Set(ids));
    })
    .pipe(z.array(idSchema).min(1).max(max));
}

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
