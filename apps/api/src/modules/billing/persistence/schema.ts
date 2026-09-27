import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

/** Stable, not tenant-extendable (CLAUDE.md §7); the values of `LEDGER_ENTRY_KINDS` in contracts. */
export const ledgerEntryKind = pgEnum('ledger_entry_kind', ['opening_balance', 'adjustment']);

/**
 * The patient ledger (feature 3). `amount` is signed — positive means the patient owes — and
 * stamped with the tenant currency at write time (ADR-0015: a currency change converts nothing).
 * `patient_id` has no foreign key: `patients` owns that table (CLAUDE.md §4 rule 1). Entries are
 * never edited or deleted; only the merge job re-points `patient_id` (design Q9).
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    patientId: uuid().notNull(),
    kind: ledgerEntryKind().notNull(),
    amount: numeric({ precision: 12, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    effectiveDate: date().notNull(),
    note: text(),
    /** Why, for adjustments (the audit entry carries it too). */
    reason: text(),
    /** The auth user id of the actor who recorded the entry. */
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('ledger_entries_tenant_idx').on(table.tenantId),
    index('ledger_entries_patient_idx').on(table.tenantId, table.patientId),
    check('ledger_entries_amount_non_zero', sql`${table.amount} <> 0`),
    tenantIsolationPolicy(),
  ],
);
