import { DomainError } from '../../../platform/kernel/domain-error';

/** Two live agreements of one dentist would be in force on the same day (exclusion constraint). */
export class AgreementOverlapError extends DomainError {
  readonly code = 'compensation.overlap';
  readonly kind = 'invalid';
}

/** A date inside a closed month: an adjustment, a payout, an agreement's start or end. */
export class PeriodClosedError extends DomainError {
  readonly code = 'compensation.period_closed';
  readonly kind = 'invalid';
}

export class InvalidComponentsError extends DomainError {
  readonly code = 'compensation.invalid_components';
  readonly kind = 'invalid';
}

/** An end before the start, a change of terms not after the current start, a past end. */
export class EffectiveDateError extends DomainError {
  readonly code = 'compensation.effective_date';
  readonly kind = 'invalid';
}

/** Closing a month that has not ended yet. */
export class MonthNotEndedError extends DomainError {
  readonly code = 'compensation.month_not_ended';
  readonly kind = 'invalid';
}

export class CompensationNotFoundError extends DomainError {
  readonly code = 'compensation.not_found';
  readonly kind = 'not_found';
}

export class AgreementNotFoundError extends DomainError {
  readonly code = 'agreement.not_found';
  readonly kind = 'not_found';
}

/** Voiding a voided adjustment or payout; ending a superseded agreement. */
export class NotReversibleError extends DomainError {
  readonly code = 'compensation.not_reversible';
  readonly kind = 'conflict';
}

/** Reopening a month whose next month is closed. */
export class NextPeriodClosedError extends DomainError {
  readonly code = 'compensation.next_period_closed';
  readonly kind = 'conflict';
}

/** Closing a month before the previous one (months close in order, ADR-0059). */
export class PreviousPeriodOpenError extends DomainError {
  readonly code = 'compensation.previous_period_open';
  readonly kind = 'conflict';
}

export class AlreadyClosedError extends DomainError {
  readonly code = 'compensation.already_closed';
  readonly kind = 'conflict';
}

/** Reopening a month that is not closed. */
export class NotClosedError extends DomainError {
  readonly code = 'compensation.not_closed';
  readonly kind = 'conflict';
}

/** An `Idempotency-Key` replayed with a different request. */
export class CompensationIdempotencyMismatchError extends DomainError {
  readonly code = 'compensation.idempotency_mismatch';
  readonly kind = 'conflict';
}
