import {
  EXPENSE_CATEGORY_KEYS,
  EXPENSE_SOURCES,
  FIXED_EXPENSE_STATUSES,
  FIXED_ITEM_STATUSES,
  PAYMENT_METHODS,
} from '@dcm/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
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

const money = () => numeric({ precision: 12, scale: 2 });
const instant = () => timestamp({ withTimezone: true });
const month = () => char({ length: 7 });
const quoted = (values: readonly string[]) =>
  sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
const MONTH_FORMAT = "'^[0-9]{4}-(0[1-9]|1[0-2])$'";

/**
 * What the clinic spends on (feature 17, D7). A keyed row is the starting list, *Other* or a
 * reserved category, its name translated by key; a custom row has its own name. Never deleted
 * once used.
 */
export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    key: text({ enum: EXPENSE_CATEGORY_KEYS }),
    name: text(),
    active: boolean().notNull().default(true),
    /** Null for the rows the system seeded. */
    createdBy: uuid(),
    ...timestamps(),
  },
  (table) => [
    index('expense_categories_tenant_idx').on(table.tenantId),
    uniqueIndex('expense_categories_key_unique')
      .on(table.tenantId, table.key)
      .where(sql`${table.key} is not null`),
    uniqueIndex('expense_categories_name_unique')
      .on(table.tenantId, sql`lower(${table.name})`)
      .where(sql`${table.name} is not null`),
    check('expense_categories_key_or_name', sql`(${table.key} is null) <> (${table.name} is null)`),
    tenantIsolationPolicy(),
  ],
);

/**
 * A payment the clinic made (P3). Typed (`manual`), confirmed from a fixed item (`fixed`), or
 * mirrored in the transaction of a salary payment (`payroll`) or a dentist payout
 * (`compensation`), ADR-0076. Edited with audit, voided with a reason, never deleted.
 * `branch_id` has no foreign key: `tenancy` owns branches.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    spentOn: date().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => expenseCategories.id),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    method: text({ enum: PAYMENT_METHODS }).notNull(),
    payee: text(),
    reference: text(),
    description: text(),
    branchId: uuid(),
    source: text({ enum: EXPENSE_SOURCES }).notNull(),
    /** The fixed item, payroll payment or payout this row comes from. */
    sourceId: uuid(),
    sourceMonth: month(),
    createdBy: uuid().notNull(),
    updatedBy: uuid(),
    voidedAt: instant(),
    voidedBy: uuid(),
    voidReason: text(),
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('expenses_tenant_idx').on(table.tenantId),
    index('expenses_spent_on_idx').on(table.tenantId, table.spentOn),
    index('expenses_idempotency_idx')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    uniqueIndex('expenses_manual_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null and ${table.source} = 'manual'`),
    /** One row per payroll payment or payout, ever. */
    uniqueIndex('expenses_mirror_unique')
      .on(table.tenantId, table.source, table.sourceId)
      .where(sql`${table.source} in ('payroll', 'compensation')`),
    /** At most one live expense per fixed item; a voided one makes room for the next. */
    uniqueIndex('expenses_fixed_live_unique')
      .on(table.tenantId, table.sourceId)
      .where(sql`${table.source} = 'fixed' and ${table.voidedAt} is null`),
    check('expenses_amount_positive', sql`${table.amount} > 0`),
    check('expenses_method', sql`${table.method} in ${quoted(PAYMENT_METHODS)}`),
    check('expenses_source', sql`${table.source} in ${quoted(EXPENSE_SOURCES)}`),
    check('expenses_source_id', sql`(${table.source} = 'manual') = (${table.sourceId} is null)`),
    check(
      'expenses_source_month_format',
      sql`${table.sourceMonth} is null or ${table.sourceMonth} ~ ${sql.raw(MONTH_FORMAT)}`,
    ),
    check(
      'expenses_void_complete',
      sql`(${table.voidedAt} is null) = (${table.voidedBy} is null) and (${table.voidedAt} is null) = (${table.voidReason} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A monthly template (A3). While active, the catch-up generates one item per month from
 * `next_month` through the current month (ADR-0078). Never deleted; ended is final.
 */
export const fixedExpenses = pgTable(
  'fixed_expenses',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    name: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => expenseCategories.id),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    method: text({ enum: PAYMENT_METHODS }),
    payee: text(),
    branchId: uuid(),
    note: text(),
    firstMonth: month().notNull(),
    nextMonth: month().notNull(),
    status: text({ enum: FIXED_EXPENSE_STATUSES }).notNull().default('active'),
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('fixed_expenses_tenant_idx').on(table.tenantId),
    check('fixed_expenses_amount_positive', sql`${table.amount} > 0`),
    check('fixed_expenses_status', sql`${table.status} in ${quoted(FIXED_EXPENSE_STATUSES)}`),
    check(
      'fixed_expenses_month_format',
      sql`${table.firstMonth} ~ ${sql.raw(MONTH_FORMAT)} and ${table.nextMonth} ~ ${sql.raw(MONTH_FORMAT)}`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * One month of a fixed expense, a snapshot of the template when it was generated: a later edit of
 * the template never changes it. Pending items are not expenses (A3). Never deleted.
 */
export const fixedExpenseItems = pgTable(
  'fixed_expense_items',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    fixedExpenseId: uuid()
      .notNull()
      .references(() => fixedExpenses.id),
    month: month().notNull(),
    name: text().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => expenseCategories.id),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    method: text({ enum: PAYMENT_METHODS }),
    payee: text(),
    branchId: uuid(),
    status: text({ enum: FIXED_ITEM_STATUSES }).notNull().default('pending'),
    /** The live expense confirming it; cleared when that expense is voided. */
    expenseId: uuid().references(() => expenses.id),
    skipReason: text(),
    skippedAt: instant(),
    skippedBy: uuid(),
    ...timestamps(),
  },
  (table) => [
    index('fixed_expense_items_tenant_idx').on(table.tenantId),
    index('fixed_expense_items_status_idx').on(table.tenantId, table.status, table.month),
    uniqueIndex('fixed_expense_items_month_unique').on(table.fixedExpenseId, table.month),
    check('fixed_expense_items_status', sql`${table.status} in ${quoted(FIXED_ITEM_STATUSES)}`),
    check('fixed_expense_items_month_format', sql`${table.month} ~ ${sql.raw(MONTH_FORMAT)}`),
    check(
      'fixed_expense_items_confirmed',
      sql`(${table.status} = 'confirmed') = (${table.expenseId} is not null)`,
    ),
    tenantIsolationPolicy(),
  ],
);
