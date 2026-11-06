import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { balanceAmountSchema, exportLanguageSchema, paymentMethodSchema } from './billing.js';
import { fromCents, toCents } from './cents.js';
import {
  blankToUndefined,
  currencySchema,
  decimalAmountSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  nameSchema,
  optionalText,
} from './common.js';
import { monthSchema, positiveAmountSchema } from './compensation.js';
import { practitionerTypeSchema } from './practitioners.js';

/**
 * Feature 17 (spec `2026-11-06-expenses-and-payroll-design.md`, ADR-0077–0079): the clinic's
 * employees who are not dentists, their salary history, and the monthly run. A confirmed line is a
 * salary payment, mirrored into Expenses as a *Salaries* row.
 */

/** Stored events, hidden from the audit log without `payroll:read` (ADR-0080). */
export const PAYROLL_EVENTS = ['PayrollPaymentConfirmed', 'PayrollPaymentVoided'] as const;

export const EMPLOYEE_STATUSES = ['active', 'left'] as const;
export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;

/** Why a linked user needs the owner's eye: deactivated, or now a dentist (D2). */
export const LINK_NOTICES = ['deactivated', 'dentist'] as const;
export type LinkNotice = (typeof LINK_NOTICES)[number];

export const salaryInForceSchema = z.object({
  amount: balanceAmountSchema,
  currency: currencySchema,
  effectiveMonth: monthSchema,
});

export const employeeSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  hireDate: isoDateSchema,
  /** The first month payroll lines are made for. */
  payrollFrom: monthSchema,
  branchId: idSchema.nullable(),
  status: employeeStatusSchema,
  endDate: isoDateSchema.nullable(),
  note: z.string().nullable(),
  staffProfileId: idSchema.nullable(),
  linkedUserName: z.string().nullable(),
  linkNotice: z.enum(LINK_NOTICES).nullable(),
  /** The salary of the current month; null before the first entry takes effect. */
  currentSalary: salaryInForceSchema.nullable(),
  /** No payroll line was ever touched: Remove is offered. */
  removable: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type Employee = z.infer<typeof employeeSchema>;

const PHONE_MAX = 40;
const NOTE_MAX = 500;
const TITLE_MAX = 80;

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .nullish()
  .transform((value) => (value ? value : null))
  .pipe(z.union([z.null(), z.email()]));

const employeeDetails = {
  fullName: nameSchema,
  jobTitle: optionalText(TITLE_MAX),
  phone: optionalText(PHONE_MAX),
  email: optionalEmail,
  hireDate: isoDateSchema.refine((date) => date >= '2000-01-01', 'Expected a date from 2000 on'),
  payrollFrom: monthSchema,
  branchId: idSchema.nullish().transform((value) => value ?? null),
  note: optionalText(NOTE_MAX),
};

const salaryFields = {
  amount: positiveAmountSchema,
  effectiveMonth: monthSchema,
};

/** `POST /payroll/employees`: the details, an optional link and the first salary. */
export const createEmployeeSchema = z
  .object({
    ...employeeDetails,
    staffProfileId: idSchema.nullish().transform((value) => value ?? null),
    salary: z.object(salaryFields),
  })
  .refine((input) => input.payrollFrom >= input.hireDate.slice(0, 7), {
    path: ['payrollFrom'],
    message: 'Payroll starts on or after the hire month',
  });
export type CreateEmployee = z.infer<typeof createEmployeeSchema>;
export type CreateEmployeeRequest = z.input<typeof createEmployeeSchema>;

/**
 * `PATCH /payroll/employees/:id`: details, the link (`staffProfileId`, null unlinks) and the
 * status (`left` with `endDate`, `active` undoes it). Each kind of change is audited on its own.
 */
export const updateEmployeeSchema = z
  .object({
    ...employeeDetails,
    staffProfileId: idSchema.nullable(),
    status: employeeStatusSchema,
    endDate: isoDateSchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change')
  .refine((patch) => patch.status !== 'left' || typeof patch.endDate === 'string', {
    path: ['endDate'],
    message: 'Say when they left',
  });
export type UpdateEmployee = z.infer<typeof updateEmployeeSchema>;
export type UpdateEmployeeRequest = z.input<typeof updateEmployeeSchema>;

export const employeeListQuerySchema = z.object({
  q: blankToUndefined(z.string().trim().max(100).optional()),
  status: blankToUndefined(employeeStatusSchema.optional()),
  branchId: blankToUndefined(idSchema.optional()),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

/** A staff user who may be linked: active and not a dentist (ADR-0077). */
export const linkableStaffSchema = z.object({
  profileId: idSchema,
  displayName: z.string(),
  practitionerType: practitionerTypeSchema,
  /** Already linked to this employee. */
  linkedEmployeeId: idSchema.nullable(),
});
export type LinkableStaff = z.infer<typeof linkableStaffSchema>;

export const changeSalarySchema = z.object({
  ...salaryFields,
  reason: optionalText(NOTE_MAX),
});
export type ChangeSalary = z.infer<typeof changeSalarySchema>;
export type ChangeSalaryRequest = z.input<typeof changeSalarySchema>;

export const salaryEntrySchema = z.object({
  id: idSchema,
  amount: balanceAmountSchema,
  currency: currencySchema,
  effectiveMonth: monthSchema,
  reason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  createdByName: z.string().nullable(),
});
export type SalaryEntry = z.infer<typeof salaryEntrySchema>;

// --- Lines ---

export const PAYROLL_ADJUSTMENT_KINDS = ['bonus', 'deduction', 'other'] as const;
export const payrollAdjustmentKindSchema = z.enum(PAYROLL_ADJUSTMENT_KINDS);
export type PayrollAdjustmentKind = z.infer<typeof payrollAdjustmentKindSchema>;

const ADJUSTMENT_LABEL_MAX = 80;
export const ADJUSTMENTS_MAX = 20;

const isZero = (amount: string) => /^-?0+(\.0+)?$/.test(amount);

/** A bonus or a deduction is typed positive (a deduction subtracts); *Other* is signed. */
export const payrollAdjustmentSchema = z
  .object({
    kind: payrollAdjustmentKindSchema,
    label: z.string().trim().min(1).max(ADJUSTMENT_LABEL_MAX),
    amount: decimalAmountSchema,
  })
  .refine(
    (adjustment) =>
      adjustment.kind === 'other'
        ? !isZero(adjustment.amount)
        : !adjustment.amount.startsWith('-') && !isZero(adjustment.amount),
    { path: ['amount'], message: 'Enter an amount greater than zero' },
  );
export type PayrollAdjustment = z.infer<typeof payrollAdjustmentSchema>;

export const setAdjustmentsSchema = z.object({
  adjustments: z.array(payrollAdjustmentSchema).max(ADJUSTMENTS_MAX),
});
export type SetAdjustments = z.infer<typeof setAdjustmentsSchema>;

/** What an adjustment does to the net, in cents. */
export function adjustmentEffect(adjustment: Pick<PayrollAdjustment, 'kind' | 'amount'>): bigint {
  const cents = toCents(adjustment.amount);
  return adjustment.kind === 'deduction' ? -cents : cents;
}

/** `base + Σ effects`, in cents, before the floor at zero; null without a base. */
export function rawNetCents(
  base: string | null,
  adjustments: readonly Pick<PayrollAdjustment, 'kind' | 'amount'>[],
): bigint | null {
  if (base === null) return null;
  return adjustments.reduce((sum, adjustment) => sum + adjustmentEffect(adjustment), toCents(base));
}

/** The net pay shown: never below zero; `0.00` without a base. */
export function netPay(
  base: string | null,
  adjustments: readonly Pick<PayrollAdjustment, 'kind' | 'amount'>[],
): string {
  const raw = rawNetCents(base, adjustments);
  return fromCents(raw === null || raw < 0n ? 0n : raw);
}

export const PAYROLL_LINE_STATUSES = ['pending', 'paid', 'skipped'] as const;
export const payrollLineStatusSchema = z.enum(PAYROLL_LINE_STATUSES);
export type PayrollLineStatus = z.infer<typeof payrollLineStatusSchema>;

export const payrollPaymentSchema = z.object({
  id: idSchema,
  paidOn: isoDateSchema,
  method: paymentMethodSchema,
  note: z.string().nullable(),
  base: balanceAmountSchema,
  adjustments: z.array(payrollAdjustmentSchema),
  net: balanceAmountSchema,
  currency: currencySchema,
  createdAt: isoDateTimeSchema,
  voidedAt: isoDateTimeSchema.nullable(),
  voidReason: z.string().nullable(),
});
export type PayrollPayment = z.infer<typeof payrollPaymentSchema>;

export const payrollLineSchema = z.object({
  employeeId: idSchema,
  employeeName: z.string(),
  jobTitle: z.string().nullable(),
  branchId: idSchema.nullable(),
  month: monthSchema,
  status: payrollLineStatusSchema,
  /** The salary in force (pending), or the base paid (paid); null with no salary yet. */
  base: balanceAmountSchema.nullable(),
  adjustments: z.array(payrollAdjustmentSchema),
  net: balanceAmountSchema,
  currency: currencySchema,
  /** The hire date when it falls in this month, the first line's note. */
  joinedOn: isoDateSchema.nullable(),
  /** The end date when it falls in this month, the last line's note. */
  leftOn: isoDateSchema.nullable(),
  skipReason: z.string().nullable(),
  payment: payrollPaymentSchema.nullable(),
  voidedPayments: z.array(payrollPaymentSchema),
});
export type PayrollLine = z.infer<typeof payrollLineSchema>;

export const payrollRunSchema = z.object({
  month: monthSchema,
  lines: z.array(payrollLineSchema),
  totals: z.object({
    employees: z.number().int().nonnegative(),
    paidNet: balanceAmountSchema,
    pendingNet: balanceAmountSchema,
    skipped: z.number().int().nonnegative(),
  }),
  /** Months before this one with lines still pending, oldest first. */
  earlierPending: z.array(z.object({ month: monthSchema, count: z.number().int().positive() })),
});
export type PayrollRun = z.infer<typeof payrollRunSchema>;

export const PAYROLL_CONFIRM_MAX = 50;

/** `POST /payroll/confirm` (Idempotency-Key): each line with the net the user saw. */
export const confirmLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        employeeId: idSchema,
        month: monthSchema,
        paidOn: isoDateSchema,
        method: paymentMethodSchema,
        note: optionalText(NOTE_MAX),
        net: decimalAmountSchema,
      }),
    )
    .min(1)
    .max(PAYROLL_CONFIRM_MAX)
    .refine(
      (lines) =>
        new Set(lines.map((line) => `${line.employeeId}:${line.month}`)).size === lines.length,
      'A line is listed twice',
    ),
});
export type ConfirmLines = z.infer<typeof confirmLinesSchema>;
export type ConfirmLinesRequest = z.input<typeof confirmLinesSchema>;

export const payrollReasonSchema = z.object({ reason: reasonSchema });
export type PayrollReason = z.infer<typeof payrollReasonSchema>;

export const employeeDetailSchema = z.object({
  employee: employeeSchema,
  /** Newest first. */
  salaries: z.array(salaryEntrySchema),
  /** Every employed month, newest first. */
  history: z.array(payrollLineSchema),
});
export type EmployeeDetail = z.infer<typeof employeeDetailSchema>;

export const payrollYearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
export type PayrollYearQuery = z.infer<typeof payrollYearQuerySchema>;

export const payrollMonthsSchema = z.object({
  year: z.number().int(),
  months: z.array(
    z.object({
      month: monthSchema,
      paidNet: balanceAmountSchema,
      paidCount: z.number().int().nonnegative(),
      pendingCount: z.number().int().nonnegative(),
    }),
  ),
  paidNet: balanceAmountSchema,
});
export type PayrollMonths = z.infer<typeof payrollMonthsSchema>;

export const payrollExportQuerySchema = z.object({
  lang: blankToUndefined(exportLanguageSchema.optional()),
});
export const payrollYearExportQuerySchema = payrollYearQuerySchema.extend(
  payrollExportQuerySchema.shape,
);
export type PayrollExportQuery = z.infer<typeof payrollExportQuerySchema>;
export type PayrollYearExportQuery = z.infer<typeof payrollYearExportQuerySchema>;
