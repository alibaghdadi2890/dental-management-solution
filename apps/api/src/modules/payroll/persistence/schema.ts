import {
  EMPLOYEE_STATUSES,
  PAYMENT_METHODS,
  PAYROLL_ADJUSTMENT_KINDS,
  PAYROLL_LINE_STATUSES,
  type PayrollAdjustment,
} from '@dcm/contracts';
import { sql } from 'drizzle-orm';
import {
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
  deletedAtColumn,
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
 * Someone the clinic pays monthly who is not a dentist (ADR-0077). Optionally linked to one staff
 * profile (no foreign key: `users` owns `staff_profiles`); linking changes no access. Removed
 * softly, and only before any payroll (D8).
 */
export const employees = pgTable(
  'employees',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    fullName: text().notNull(),
    jobTitle: text(),
    phone: text(),
    email: text(),
    hireDate: date().notNull(),
    payrollFrom: month().notNull(),
    branchId: uuid(),
    status: text({ enum: EMPLOYEE_STATUSES }).notNull().default('active'),
    endDate: date(),
    note: text(),
    staffProfileId: uuid(),
    createdBy: uuid().notNull(),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('employees_tenant_idx').on(table.tenantId),
    uniqueIndex('employees_staff_profile_unique')
      .on(table.tenantId, table.staffProfileId)
      .where(sql`${table.staffProfileId} is not null and ${table.deletedAt} is null`),
    check('employees_status', sql`${table.status} in ${quoted(EMPLOYEE_STATUSES)}`),
    check(
      'employees_left_has_end',
      sql`(${table.status} = 'left') = (${table.endDate} is not null)`,
    ),
    check(
      'employees_end_after_hire',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.hireDate}`,
    ),
    check('employees_payroll_from_format', sql`${table.payrollFrom} ~ ${sql.raw(MONTH_FORMAT)}`),
    tenantIsolationPolicy(),
  ],
);

/**
 * A monthly salary from its effective month on (ADR-0079). Append-only: a change or a correction
 * is a new row, so the history is never rewritten.
 */
export const employeeSalaries = pgTable(
  'employee_salaries',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    effectiveMonth: month().notNull(),
    reason: text(),
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('employee_salaries_tenant_idx').on(table.tenantId),
    index('employee_salaries_employee_idx').on(table.tenantId, table.employeeId),
    check('employee_salaries_amount_positive', sql`${table.amount} > 0`),
    check(
      'employee_salaries_month_format',
      sql`${table.effectiveMonth} ~ ${sql.raw(MONTH_FORMAT)}`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A payroll line someone touched (adjusted, skipped or paid). Untouched lines are derived from the
 * employment and the salary history and have no row (ADR-0078). Never deleted.
 */
export const payrollLines = pgTable(
  'payroll_lines',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    month: month().notNull(),
    status: text({ enum: PAYROLL_LINE_STATUSES }).notNull().default('pending'),
    skipReason: text(),
    skippedAt: instant(),
    skippedBy: uuid(),
    ...timestamps(),
  },
  (table) => [
    index('payroll_lines_tenant_idx').on(table.tenantId),
    uniqueIndex('payroll_lines_month_unique').on(table.tenantId, table.employeeId, table.month),
    check('payroll_lines_status', sql`${table.status} in ${quoted(PAYROLL_LINE_STATUSES)}`),
    check('payroll_lines_month_format', sql`${table.month} ~ ${sql.raw(MONTH_FORMAT)}`),
    tenantIsolationPolicy(),
  ],
);

/** A pending line's bonuses, deductions and others, replaced as a list (they are its content). */
export const payrollAdjustments = pgTable(
  'payroll_adjustments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    lineId: uuid()
      .notNull()
      .references(() => payrollLines.id),
    kind: text({ enum: PAYROLL_ADJUSTMENT_KINDS }).notNull(),
    label: text().notNull(),
    /** As typed: a deduction is positive and subtracts. */
    amount: money().notNull(),
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('payroll_adjustments_tenant_idx').on(table.tenantId),
    index('payroll_adjustments_line_idx').on(table.tenantId, table.lineId),
    check('payroll_adjustments_kind', sql`${table.kind} in ${quoted(PAYROLL_ADJUSTMENT_KINDS)}`),
    tenantIsolationPolicy(),
  ],
);

/**
 * A salary payment: what was paid for the line, frozen (base, adjustments, net). Voided with a
 * reason, never deleted; at most one live payment per line.
 */
export const payrollPayments = pgTable(
  'payroll_payments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    lineId: uuid()
      .notNull()
      .references(() => payrollLines.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    month: month().notNull(),
    base: money().notNull(),
    adjustments: jsonb().$type<PayrollAdjustment[]>().notNull(),
    net: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    paidOn: date().notNull(),
    method: text({ enum: PAYMENT_METHODS }).notNull(),
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
    index('payroll_payments_tenant_idx').on(table.tenantId),
    index('payroll_payments_employee_idx').on(table.tenantId, table.employeeId, table.month),
    index('payroll_payments_idempotency_idx')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    uniqueIndex('payroll_payments_live_unique')
      .on(table.tenantId, table.lineId)
      .where(sql`${table.voidedAt} is null`),
    check('payroll_payments_net_positive', sql`${table.net} > 0`),
    check('payroll_payments_method', sql`${table.method} in ${quoted(PAYMENT_METHODS)}`),
    check(
      'payroll_payments_void_complete',
      sql`(${table.voidedAt} is null) = (${table.voidedBy} is null) and (${table.voidedAt} is null) = (${table.voidReason} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);
