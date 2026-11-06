import { DomainError } from '../../../platform/kernel/domain-error';

export class EmployeeNotFoundError extends DomainError {
  readonly code = 'payroll.not_found';
  readonly kind = 'not_found';
}

/** A staff profile that is not this clinic's. */
export class StaffNotFoundError extends DomainError {
  readonly code = 'payroll.staff_not_found';
  readonly kind = 'not_found';
}

/** Dentists are paid through compensation, never payroll (ADR-0077). */
export class DentistNotLinkableError extends DomainError {
  readonly code = 'payroll.dentist_not_linkable';
  readonly kind = 'invalid';
}

/** A staff user is linked to one employee at most. */
export class UserAlreadyLinkedError extends DomainError {
  readonly code = 'payroll.user_already_linked';
  readonly kind = 'conflict';
}

/** A salary taking effect in or before a month already paid (ADR-0079). */
export class MonthPaidError extends DomainError {
  readonly code = 'payroll.month_paid';
  readonly kind = 'conflict';
}

/** A hire date, first payroll month or end date that would leave a paid month outside. */
export class PaidOutsideEmploymentError extends DomainError {
  readonly code = 'payroll.paid_outside_employment';
  readonly kind = 'conflict';
}

/** A first payroll month before the hire month, an end before the hire, a leave without a date. */
export class InvalidEmploymentError extends DomainError {
  readonly code = 'payroll.invalid_dates';
  readonly kind = 'invalid';
}

/** A month the employee is not employed in, or one that has not come yet. */
export class NotEmployedError extends DomainError {
  readonly code = 'payroll.not_employed';
  readonly kind = 'invalid';
}

/** Adjusting, confirming or skipping a line that is not pending; undoing what is not there. */
export class LineNotPendingError extends DomainError {
  readonly code = 'payroll.line_not_pending';
  readonly kind = 'conflict';
}

export class NoSalaryError extends DomainError {
  readonly code = 'payroll.no_salary';
  readonly kind = 'invalid';
}

/** Net pay must be above zero to be paid; skip the line instead. */
export class NetNotPositiveError extends DomainError {
  readonly code = 'payroll.net_not_positive';
  readonly kind = 'invalid';
}

/** Deductions larger than the base and bonuses. */
export class NetNegativeError extends DomainError {
  readonly code = 'payroll.net_negative';
  readonly kind = 'invalid';
}

/** The net the user confirmed is not the line's any more: someone changed it in between. */
export class StaleLineError extends DomainError {
  readonly code = 'payroll.stale';
  readonly kind = 'conflict';
}

/** A payment dated after today in the clinic's time zone. */
export class PayrollFutureDateError extends DomainError {
  readonly code = 'payroll.future_date';
  readonly kind = 'invalid';
}

/** Removing an employee who has payroll: mark them as left instead (D8). */
export class NotRemovableError extends DomainError {
  readonly code = 'payroll.not_removable';
  readonly kind = 'conflict';
}

export class PayrollIdempotencyMismatchError extends DomainError {
  readonly code = 'payroll.idempotency_mismatch';
  readonly kind = 'conflict';
}

/** The clinic has salaries in its currency (ADR-0035, extended by feature 17). */
export class PayrollCurrencyLockedError extends DomainError {
  readonly code = 'tenant.currency_locked';
  readonly kind = 'invalid';
}
