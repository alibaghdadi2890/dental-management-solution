import { z } from 'zod';
import {
  decimalAmountSchema,
  idSchema,
  isoDateSchema,
  moneySchema,
  notFutureDateSchema,
  optionalText,
} from './common.js';
import { reasonSchema } from './audit.js';
import { patientInputSchema, patientListQuerySchema, patientSchema } from './patients.js';

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

/** `POST /billing/opening-balances`: one transaction, `PatientsService.create` then the entry. */
export const createWithOpeningBalanceSchema = z.object({
  patient: patientInputSchema,
  openingBalance: openingBalanceInputSchema,
});
export type CreateWithOpeningBalance = z.infer<typeof createWithOpeningBalanceSchema>;

/** No UI in this feature; a building block for corrections and feature 6 import. */
export const adjustmentInputSchema = z.object({
  amount: decimalAmountSchema.refine((amount) => Number(amount) !== 0, 'Must not be zero'),
  effectiveDate: isoDateSchema,
  reason: reasonSchema,
  note: optionalText(LEDGER_NOTE_MAX),
});
export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;

/** Balance = Σ amount per currency (design Q13); a patient without entries gets `balances: []`. */
export const patientBalanceSchema = z.object({
  patientId: idSchema,
  balances: z.array(moneySchema),
});
export type PatientBalance = z.infer<typeof patientBalanceSchema>;

export const patientBalancesSchema = z.array(patientBalanceSchema);

const MAX_BALANCE_QUERY_IDS = 100;

function commaSeparatedIds(max: number) {
  return z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .pipe(z.array(idSchema).min(1).max(max));
}

export const balancesQuerySchema = z.object({
  patientIds: commaSeparatedIds(MAX_BALANCE_QUERY_IDS),
});
export type BalancesQuery = z.infer<typeof balancesQuerySchema>;

const MAX_EXPORT_IDS = 1000;

/** `GET /billing/patients/export`: the list query (paging dropped) plus an optional id filter. */
export const patientExportQuerySchema = patientListQuerySchema
  .omit({ page: true, size: true })
  .extend({
    ids: commaSeparatedIds(MAX_EXPORT_IDS).optional(),
  });
export type PatientExportQuery = z.infer<typeof patientExportQuerySchema>;

/** Result of `POST /billing/opening-balances`. */
export const openingBalanceResultSchema = z.object({
  patient: patientSchema,
  balance: patientBalanceSchema,
});
export type OpeningBalanceResult = z.infer<typeof openingBalanceResultSchema>;
