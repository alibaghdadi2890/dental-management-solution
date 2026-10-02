import type { LedgerEntryKind } from '@dcm/contracts';

/** One row of the patient ledger, as the repository maps it (CLAUDE.md §7). */
export interface LedgerEntry {
  id: string;
  patientId: string;
  kind: LedgerEntryKind;
  /** Signed decimal string with 2 decimals; positive = the patient owes. */
  amount: string;
  currency: string;
  /** `YYYY-MM-DD`. */
  effectiveDate: string;
  note: string | null;
  reason: string | null;
  createdBy: string;
  /** The visit a visit-kind entry (`VISIT_LEDGER_KINDS`) is about; null for the other kinds. */
  visitId: string | null;
  /** The amendment a `visit_charge_adjustment` posts; null for every other kind. */
  amendmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One line of a `visit_charge` (spec V7): a service as it was charged, in the entry currency. */
export interface LedgerEntryLine {
  /** 1-based, in the visit's service order. */
  position: number;
  code: string;
  name: string;
  toothCode: string | null;
  surfaces: string[];
  /** The final line price (base − line discount), a decimal string with 2 decimals. */
  amount: string;
  currency: string;
}

/**
 * One patient's sums in one currency, as aggregated by the database: `amount` over every entry,
 * `charged` over the visit entries only (charges, their adjustments and reversals).
 */
export interface PatientCurrencySum {
  patientId: string;
  amount: string;
  charged: string;
  currency: string;
}

/** One visit's ledger sum in its currency (`VISIT_LEDGER_KINDS` entries). */
export interface VisitSum {
  visitId: string;
  currency: string;
  amount: string;
}
