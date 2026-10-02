import { LEDGER_ENTRY_KINDS, VISIT_LEDGER_KINDS } from '@dcm/contracts';
import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

/** Stable, not tenant-extendable (CLAUDE.md §7); the values of `LEDGER_ENTRY_KINDS` in contracts. */
export const ledgerEntryKind = pgEnum('ledger_entry_kind', LEDGER_ENTRY_KINDS);

const money = () => numeric({ precision: 12, scale: 2 });

/**
 * The patient ledger (feature 3). `amount` is signed — positive means the patient owes — and
 * stamped with the tenant currency at write time (ADR-0015: a currency change converts nothing).
 * `patient_id` has no foreign key: `patients` owns that table (CLAUDE.md §4 rule 1). Entries are
 * never edited or deleted; only the merge job re-points `patient_id` (design Q9).
 *
 * The visit kinds (`VISIT_LEDGER_KINDS`) name their visit in `visit_id` — no foreign key either,
 * `clinical` owns `visits`: the `visit_charge` (feature 4a, ADR-0024), then any number of
 * `visit_charge_adjustment`s (amendments) and at most one `visit_charge_reversal` (a void, 4b).
 * An adjustment names the `visit_amendments` row it posts (`amendment_id`, no foreign key), so a
 * visit is charged once, reversed once and adjusted once per amendment
 * (`ledger_entries_visit_kind_unique`).
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    patientId: uuid().notNull(),
    kind: ledgerEntryKind().notNull(),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    effectiveDate: date().notNull(),
    note: text(),
    /** Why, for adjustments (the audit entry carries it too). */
    reason: text(),
    /** The auth user id of the actor who recorded the entry. */
    createdBy: uuid().notNull(),
    /** The visit a visit-kind entry is about; set iff the kind is one of `VISIT_LEDGER_KINDS`. */
    visitId: uuid(),
    /** The amendment a `visit_charge_adjustment` posts; set iff the kind is that (4b). */
    amendmentId: uuid(),
    ...timestamps(),
  },
  (table) => [
    index('ledger_entries_tenant_idx').on(table.tenantId),
    index('ledger_entries_patient_idx').on(table.tenantId, table.patientId),
    // Target of the composite foreign key from `ledger_entry_lines`.
    unique('ledger_entries_tenant_id_unique').on(table.tenantId, table.id),
    // A second guard against a double charge (W2) or a double reversal, after the visit lock that
    // `complete` and `void` hold.
    // No enum literal in the predicate: index predicates must be immutable, and an enum's text
    // cast isn't. A charge and a reversal have no amendment, so the coalesce makes them unique.
    uniqueIndex('ledger_entries_visit_kind_unique')
      .on(
        table.tenantId,
        table.visitId,
        table.kind,
        sql`coalesce(${table.amendmentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.visitId} is not null`),
    // A visit's balance (`GET /billing/visits/balances`, the Unpaid tab).
    index('ledger_entries_visit_idx')
      .on(table.tenantId, table.visitId)
      .where(sql`${table.visitId} is not null`),
    check('ledger_entries_amount_non_zero', sql`${table.amount} <> 0`),
    // Compared as text: the migrations run in one transaction, and Postgres refuses a literal of an
    // enum value added in the same transaction (`0016_ledger_visit_charge_kind`).
    check(
      'ledger_entries_visit_iff_visit_kind',
      sql`(${table.visitId} is not null) = (${table.kind}::text in ${sql.raw(`(${VISIT_LEDGER_KINDS.map((kind) => `'${kind}'`).join(', ')})`)})`,
    ),
    check(
      'ledger_entries_amendment_iff_adjustment',
      sql`(${table.amendmentId} is not null) = (${table.kind}::text = 'visit_charge_adjustment')`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * The lines of a `visit_charge` (spec V7): a snapshot of the visit's services as they were
 * charged — code, name, tooth, surfaces and the final line price, in the entry's currency — in
 * the visit's order. The entry's amount is the visit total after the visit-level discount, so it
 * need not equal the sum of its lines. Append-only like the entries (migration
 * `0018_ledger_lines_append_only`); a merge re-point moves the entry and so its lines.
 */
export const ledgerEntryLines = pgTable(
  'ledger_entry_lines',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    entryId: uuid().notNull(),
    /** 1-based, in the visit's service order. */
    position: integer().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    toothCode: text(),
    surfaces: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('ledger_entry_lines_tenant_idx').on(table.tenantId),
    uniqueIndex('ledger_entry_lines_position_unique').on(
      table.tenantId,
      table.entryId,
      table.position,
    ),
    foreignKey({
      name: 'ledger_entry_lines_entry_fk',
      columns: [table.tenantId, table.entryId],
      foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id],
    }),
    check('ledger_entry_lines_position_positive', sql`${table.position} >= 1`),
    check('ledger_entry_lines_amount_non_negative', sql`${table.amount} >= 0`),
    tenantIsolationPolicy(),
  ],
);
