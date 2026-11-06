import { type PayrollAdjustment, rawNetCents, toCents } from '@dcm/contracts';
import { monthOf, monthsBetween } from '../../../platform/kernel/months';
import {
  LineNotPendingError,
  MonthPaidError,
  NetNegativeError,
  NetNotPositiveError,
  NoSalaryError,
  PaidOutsideEmploymentError,
  StaleLineError,
} from './payroll-errors';

/** When an employee is paid from and until (B3). */
export interface Employment {
  hireDate: string;
  payrollFrom: string;
  endDate: string | null;
}

/** The first month with a line: the hire month, or the later first payroll month. */
export function firstPayrollMonth(employment: Employment): string {
  const hired = monthOf(employment.hireDate);
  return employment.payrollFrom > hired ? employment.payrollFrom : hired;
}

/**
 * Every month the employee has a line for, up to `currentMonth`: from the first payroll month to
 * the month they left (both included). Lines are derived, never generated (ADR-0078).
 */
export function employedMonths(employment: Employment, currentMonth: string): string[] {
  const last =
    employment.endDate !== null && monthOf(employment.endDate) < currentMonth
      ? monthOf(employment.endDate)
      : currentMonth;
  return monthsBetween(firstPayrollMonth(employment), last);
}

export function isEmployedIn(employment: Employment, month: string, currentMonth: string): boolean {
  return (
    month <= currentMonth &&
    month >= firstPayrollMonth(employment) &&
    (employment.endDate === null || month <= monthOf(employment.endDate))
  );
}

/** "Joined on …" on the hire month's line, "Left on …" on the end month's (no pro-rating). */
export function lineNotes(
  employment: Employment,
  month: string,
): { joinedOn: string | null; leftOn: string | null } {
  return {
    joinedOn: monthOf(employment.hireDate) === month ? employment.hireDate : null,
    leftOn:
      employment.endDate !== null && monthOf(employment.endDate) === month
        ? employment.endDate
        : null,
  };
}

/** A paid month must stay inside the employment when its dates change. */
export function assertPaidInside(employment: Employment, paidMonths: readonly string[]): void {
  const outside = paidMonths.find(
    (month) =>
      month < firstPayrollMonth(employment) ||
      (employment.endDate !== null && month > monthOf(employment.endDate)),
  );
  if (outside !== undefined) {
    throw new PaidOutsideEmploymentError(`${outside} is already paid`, { month: outside });
  }
}

export interface SalaryRow {
  amount: string;
  effectiveMonth: string;
}

/**
 * The salary in force in `month` (ADR-0079): the entry with the latest effective month not after
 * it, the later-created one winning a tie. `entries` are in creation order; null before the first.
 */
export function salaryFor<T extends SalaryRow>(entries: readonly T[], month: string): T | null {
  let found: T | null = null;
  for (const entry of entries) {
    if (
      entry.effectiveMonth <= month &&
      (found === null || entry.effectiveMonth >= found.effectiveMonth)
    ) {
      found = entry;
    }
  }
  return found;
}

/** A new salary takes effect after the last paid month: what was paid stays as paid (D4). */
export function assertEffectiveMonth(effectiveMonth: string, lastPaidMonth: string | null): void {
  if (lastPaidMonth !== null && effectiveMonth <= lastPaidMonth) {
    throw new MonthPaidError(`Payroll is paid up to ${lastPaidMonth}`, { lastPaidMonth });
  }
}

/** Adjustments are only changed on a pending line, never taking the net below zero. */
export function assertAdjustable(
  status: string,
  base: string | null,
  adjustments: readonly Pick<PayrollAdjustment, 'kind' | 'amount'>[],
): void {
  if (status !== 'pending') throw new LineNotPendingError('This line is not pending');
  const raw = rawNetCents(base, adjustments);
  if (raw !== null && raw < 0n) throw new NetNegativeError('The net pay would be below zero');
}

/**
 * A pending line with a salary and a net above zero, still at the net the user saw. Returns the
 * net in cents.
 */
export function assertConfirmable(line: {
  status: string;
  base: string | null;
  adjustments: readonly Pick<PayrollAdjustment, 'kind' | 'amount'>[];
  expectedNet: string;
}): bigint {
  if (line.status !== 'pending') throw new LineNotPendingError('This line is not pending');
  const raw = rawNetCents(line.base, line.adjustments);
  if (raw === null) throw new NoSalaryError('This employee has no salary for this month');
  if (raw <= 0n) throw new NetNotPositiveError('The net pay is zero: skip the line instead');
  if (raw !== toCents(line.expectedNet)) {
    throw new StaleLineError('This line changed; review it and confirm again');
  }
  return raw;
}
