import {
  ADJUSTMENT_KINDS,
  AGREEMENT_PRESETS,
  type AgreementComponent,
  PAYMENT_METHODS,
} from '@dcm/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';
import type { PeriodSnapshot } from '../domain/snapshot';

const money = () => numeric({ precision: 12, scale: 2 });
const instant = () => timestamp({ withTimezone: true });
const quoted = (values: readonly string[]) =>
  sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);

/**
 * How a dentist is paid (feature 13b, ADR-0058): an effective-dated set of components. Agreements
 * of one dentist never overlap — the exclusion constraint `compensation_agreements_no_overlap`
 * (migration 0053, `btree_gist`), which ignores superseded rows. Append-only: the runtime role may
 * set only the end and supersede columns. `staff_profile_id` has no foreign key: `users` owns
 * `staff_profiles` (CLAUDE.md §4 rule 1).
 */
export const compensationAgreements = pgTable(
  'compensation_agreements',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    staffProfileId: uuid().notNull(),
    preset: text({ enum: AGREEMENT_PRESETS }).notNull(),
    components: jsonb().$type<AgreementComponent[]>().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    statementVisibleToDentist: boolean().notNull().default(true),
    note: text(),
    /** The auth user id of whoever created it (CLAUDE.md §7). */
    createdBy: uuid().notNull(),
    endedAt: instant(),
    endedBy: uuid(),
    endReason: text(),
    /** Replaced from its first day by the next agreement (ADR-0058). */
    supersededAt: instant(),
    supersededBy: uuid(),
    supersedeReason: text(),
    ...timestamps(),
  },
  (table) => [
    index('compensation_agreements_tenant_idx').on(table.tenantId),
    index('compensation_agreements_profile_idx').on(table.tenantId, table.staffProfileId),
    check(
      'compensation_agreements_dates',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check(
      'compensation_agreements_supersede_complete',
      sql`(${table.supersededAt} is null) = (${table.supersededBy} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A dated, signed amount the owner adds to a dentist's statement (bonus, deduction, lab cost …).
 * Append-only: a mistake is voided with a reason (the runtime role may set only the void columns).
 */
export const compensationAdjustments = pgTable(
  'compensation_adjustments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    staffProfileId: uuid().notNull(),
    kind: text({ enum: ADJUSTMENT_KINDS }).notNull(),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    effectiveDate: date().notNull(),
    note: text(),
    createdBy: uuid().notNull(),
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    voidedAt: instant(),
    voidedBy: uuid(),
    voidReason: text(),
    ...timestamps(),
  },
  (table) => [
    index('compensation_adjustments_tenant_idx').on(table.tenantId),
    index('compensation_adjustments_profile_date_idx').on(
      table.tenantId,
      table.staffProfileId,
      table.effectiveDate,
    ),
    uniqueIndex('compensation_adjustments_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check('compensation_adjustments_amount_non_zero', sql`${table.amount} <> 0`),
    check(
      'compensation_adjustments_void_complete',
      sql`(${table.voidedAt} is null) = (${table.voidedBy} is null) and (${table.voidedAt} is null) = (${table.voidReason} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** Money paid to a dentist. Append-only, voided with a reason, like adjustments. */
export const compensationPayouts = pgTable(
  'compensation_payouts',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    staffProfileId: uuid().notNull(),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    paidOn: date().notNull(),
    /** The payments' methods (`PAYMENT_METHODS`), as text: `billing` owns the `payment_method` type. */
    method: text({ enum: PAYMENT_METHODS }).notNull(),
    reference: text(),
    note: text(),
    createdBy: uuid().notNull(),
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    voidedAt: instant(),
    voidedBy: uuid(),
    voidReason: text(),
    ...timestamps(),
  },
  (table) => [
    index('compensation_payouts_tenant_idx').on(table.tenantId),
    index('compensation_payouts_profile_date_idx').on(
      table.tenantId,
      table.staffProfileId,
      table.paidOn,
    ),
    uniqueIndex('compensation_payouts_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check('compensation_payouts_amount_positive', sql`${table.amount} > 0`),
    check('compensation_payouts_method', sql`${table.method} in ${quoted(PAYMENT_METHODS)}`),
    check(
      'compensation_payouts_void_complete',
      sql`(${table.voidedAt} is null) = (${table.voidedBy} is null) and (${table.voidedAt} is null) = (${table.voidReason} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A dentist's month once closed or reopened (ADR-0059); an open month that was never closed has no
 * row. `snapshot` is the frozen statement and `line_ids` every line id it counted (late ones
 * included), so a line of a closed month that is not among them is a late entry. A reopened row
 * keeps its last snapshot for the record; only `status = 'closed'` counts. Never deleted.
 */
export const compensationPeriods = pgTable(
  'compensation_periods',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    staffProfileId: uuid().notNull(),
    month: char({ length: 7 }).notNull(),
    status: text({ enum: ['closed', 'reopened'] }).notNull(),
    snapshot: jsonb().$type<PeriodSnapshot>().notNull(),
    lineIds: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    closedAt: instant().notNull(),
    closedBy: uuid().notNull(),
    reopenedAt: instant(),
    reopenedBy: uuid(),
    reopenReason: text(),
    /** The last close or reopen request's `Idempotency-Key` and its fingerprint. */
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('compensation_periods_tenant_idx').on(table.tenantId),
    uniqueIndex('compensation_periods_month_unique').on(
      table.tenantId,
      table.staffProfileId,
      table.month,
    ),
    check('compensation_periods_month_format', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    tenantIsolationPolicy(),
  ],
);
