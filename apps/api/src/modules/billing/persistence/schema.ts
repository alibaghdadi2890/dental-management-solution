import {
  LEDGER_ENTRY_KINDS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  VISIT_LEDGER_KINDS,
} from '@dcm/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
 * never edited or deleted; only the merge re-point changes `patient_id` (ADR-0036).
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
    /**
     * The `Idempotency-Key` of the request that recorded an opening balance or an adjustment, and
     * the fingerprint of that request (feature 7, H5): a retry finds this entry instead of
     * recording a second one.
     */
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('ledger_entries_tenant_idx').on(table.tenantId),
    uniqueIndex('ledger_entries_idempotency_key_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
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

/** Feature 5 (ADR-0027): the values of `PAYMENT_KINDS` / `PAYMENT_METHODS` in contracts. */
export const paymentKind = pgEnum('payment_kind', PAYMENT_KINDS);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
/** `allocation`: a new source's first cover; `credit_applied`: existing credit used later;
 * `release`: an allocation undone (negative). */
export const allocationKind = pgEnum('allocation_kind', [
  'allocation',
  'credit_applied',
  'release',
]);

/**
 * Payments, refunds and voids on a patient's account (feature 5, spec P1–P11). Each row posts one
 * ledger entry (`ledger_entry_id`: `payment` negative, `payment_refund` / `payment_void`
 * positive), so the ledger stays the balance. Append-only like the ledger: corrections are new
 * rows (`reverses_payment_id`); only the merge re-point may change `patient_id`.
 *
 * A household payment (B5) is one row per paid account sharing `receipt_number` and
 * `household_group_id`. Refunds and voids carry their payment's receipt number. A replayed
 * `Idempotency-Key` finds its rows by `idempotency_key`, under a lock on the key (P11).
 */
export const payments = pgTable(
  'payments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    patientId: uuid().notNull(),
    kind: paymentKind().notNull(),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    method: paymentMethod().notNull(),
    paidAt: date().notNull(),
    reference: text(),
    note: text(),
    /** Required for a refund or void (the audit entry carries it too). */
    reason: text(),
    receiptNumber: integer().notNull(),
    householdGroupId: uuid(),
    /** The contact who paid; null = the patient. No foreign key: `patients` owns contacts. */
    payerContactId: uuid(),
    /** The payment a refund or void reverses. */
    reversesPaymentId: uuid(),
    ledgerEntryId: uuid().notNull(),
    idempotencyKey: uuid(),
    /** The account's balance (tenant currency) right after a payment; the "partial" pill. */
    balanceAfter: numeric({ precision: 20, scale: 2 }),
    /** The branch it was recorded in, for later reports; null for a platform admin without one. */
    branchId: uuid(),
    /** The auth user id of the actor (CLAUDE.md §7). */
    recordedBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('payments_tenant_idx').on(table.tenantId),
    index('payments_patient_idx').on(table.tenantId, table.patientId),
    index('payments_paid_at_idx').on(table.tenantId, table.paidAt, table.createdAt),
    unique('payments_tenant_id_unique').on(table.tenantId, table.id),
    unique('payments_ledger_entry_unique').on(table.tenantId, table.ledgerEntryId),
    // Not unique: a household receipt has one row per patient, and a merge may bring two of them
    // onto one patient. The counter keeps numbers unique; the key lock keeps replays single.
    index('payments_receipt_idx')
      .on(table.tenantId, table.receiptNumber)
      .where(sql`${table.reversesPaymentId} is null`),
    index('payments_idempotency_idx')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index('payments_reverses_idx')
      .on(table.tenantId, table.reversesPaymentId)
      .where(sql`${table.reversesPaymentId} is not null`),
    foreignKey({
      name: 'payments_ledger_entry_fk',
      columns: [table.tenantId, table.ledgerEntryId],
      foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id],
    }),
    foreignKey({
      name: 'payments_reverses_fk',
      columns: [table.tenantId, table.reversesPaymentId],
      foreignColumns: [table.tenantId, table.id],
    }),
    check('payments_amount_positive', sql`${table.amount} > 0`),
    // Compared as text, like the ledger checks: the enum is created in the same migration run.
    check(
      'payments_reverses_iff_correction',
      sql`(${table.reversesPaymentId} is not null) = (${table.kind}::text <> 'payment')`,
    ),
    check(
      'payments_reason_iff_correction',
      sql`(${table.reason} is not null) = (${table.kind}::text <> 'payment')`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** The tenant's receipt sequence (`RCT-`, P10), minted like `visit_counters`. */
export const paymentCounters = pgTable(
  'payment_counters',
  {
    tenantId: tenantIdColumn().primaryKey(),
    lastValue: integer().notNull(),
    ...timestamps(),
  },
  () => [tenantIsolationPolicy()],
);

/**
 * Which charge (`target_entry_id`: an opening balance, a debit adjustment or a visit's first
 * entry) the money of a source (`source_entry_id`: a payment or a credit entry) covers (P2, P4).
 * Append-only and signed: a release is a negative row, so the current allocation of a pair is
 * Σ amount. `seq` orders rows written in one transaction (their `created_at` is the same).
 */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    seq: bigint({ mode: 'number' }).generatedAlwaysAsIdentity(),
    sourceEntryId: uuid().notNull(),
    targetEntryId: uuid().notNull(),
    amount: money().notNull(),
    kind: allocationKind().notNull(),
    /** B4: chosen in "Apply to a specific visit". */
    manual: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    index('payment_allocations_tenant_idx').on(table.tenantId),
    index('payment_allocations_source_idx').on(table.tenantId, table.sourceEntryId),
    index('payment_allocations_target_idx').on(table.tenantId, table.targetEntryId),
    foreignKey({
      name: 'payment_allocations_source_fk',
      columns: [table.tenantId, table.sourceEntryId],
      foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id],
    }),
    foreignKey({
      name: 'payment_allocations_target_fk',
      columns: [table.tenantId, table.targetEntryId],
      foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id],
    }),
    check('payment_allocations_amount_non_zero', sql`${table.amount} <> 0`),
    tenantIsolationPolicy(),
  ],
);
