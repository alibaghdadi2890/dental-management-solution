import { DomainError } from '../../../platform/kernel/domain-error';

export class ExpenseNotFoundError extends DomainError {
  readonly code = 'expense.not_found';
  readonly kind = 'not_found';
}

/** A category name another category of the clinic has, in any of its languages (D7). */
export class CategoryNameTakenError extends DomainError {
  readonly code = 'expense.category_name_taken';
  readonly kind = 'invalid';
}

/** Renaming, deactivating or deleting what that kind of category never allows (D7). */
export class CategoryLockedError extends DomainError {
  readonly code = 'expense.category_locked';
  readonly kind = 'conflict';
}

/** Deleting a category some expense, fixed expense or item uses. */
export class CategoryInUseError extends DomainError {
  readonly code = 'expense.category_in_use';
  readonly kind = 'conflict';
}

/** A new expense, fixed expense or confirmation on a deactivated category. */
export class CategoryInactiveError extends DomainError {
  readonly code = 'expense.category_inactive';
  readonly kind = 'invalid';
}

/** Salaries and Dentist compensation are written by the system only (P4). */
export class CategoryReservedError extends DomainError {
  readonly code = 'expense.category_reserved';
  readonly kind = 'invalid';
}

/** *Other* needs to say what the expense was. */
export class DescriptionRequiredError extends DomainError {
  readonly code = 'expense.description_required';
  readonly kind = 'invalid';
}

/** An expense dated after today in the clinic's time zone. */
export class FutureDateError extends DomainError {
  readonly code = 'expense.future_date';
  readonly kind = 'invalid';
}

/** Editing or voiding a mirrored salary or payout row from Expenses (ADR-0076). */
export class SystemRowError extends DomainError {
  readonly code = 'expense.system_row';
  readonly kind = 'conflict';
}

/** Editing or voiding a voided expense. */
export class ExpenseVoidedError extends DomainError {
  readonly code = 'expense.voided';
  readonly kind = 'conflict';
}

/** Confirming or skipping an item that is not pending; undoing a skip that is not skipped. */
export class ItemNotPendingError extends DomainError {
  readonly code = 'expense.item_not_pending';
  readonly kind = 'conflict';
}

/** Pausing what is not active, resuming what is not paused, changing an ended template. */
export class FixedExpenseStatusError extends DomainError {
  readonly code = 'expense.fixed_status';
  readonly kind = 'conflict';
}

export class ExpenseIdempotencyMismatchError extends DomainError {
  readonly code = 'expense.idempotency_mismatch';
  readonly kind = 'conflict';
}

/** The clinic has spent money in its currency (ADR-0035, extended by feature 17). */
export class ExpenseCurrencyLockedError extends DomainError {
  readonly code = 'tenant.currency_locked';
  readonly kind = 'invalid';
}

export class CategoryNotFoundError extends DomainError {
  readonly code = 'expense.category_not_found';
  readonly kind = 'not_found';
}
