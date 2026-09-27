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
  createdAt: Date;
  updatedAt: Date;
}

/** One patient's sum in one currency, as aggregated by the database. */
export interface PatientCurrencySum {
  patientId: string;
  amount: string;
  currency: string;
}
