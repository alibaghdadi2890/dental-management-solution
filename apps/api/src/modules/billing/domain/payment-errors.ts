import { DomainError } from '../../../platform/kernel/domain-error';

/** The amount is above what the paid account(s) owe (B3: no over-payment in the panel). */
export class PaymentOverOutstandingError extends DomainError {
  readonly code = 'payment.over_outstanding';
  readonly kind = 'invalid';
}

/** Nothing is owed in the tenant currency, so there is nothing to pay. */
export class NothingOutstandingError extends DomainError {
  readonly code = 'payment.nothing_outstanding';
  readonly kind = 'invalid';
}

/** The B4 target or the context visit isn't an open charge of the paid account(s). */
export class PaymentTargetInvalidError extends DomainError {
  readonly code = 'payment.invalid_target';
  readonly kind = 'invalid';
}

export class PaymentNotFoundError extends DomainError {
  readonly code = 'payment.not_found';
  readonly kind = 'not_found';
}

/** An `Idempotency-Key` replayed with a different request (P11). */
export class IdempotencyMismatchError extends DomainError {
  readonly code = 'payment.idempotency_mismatch';
  readonly kind = 'conflict';
}

/** A refund above what is left of the payment (P6). */
export class OverRefundError extends DomainError {
  readonly code = 'payment.over_refund';
  readonly kind = 'conflict';
}

/** A void or refund of a voided payment, or of a refund row (P6, P7). */
export class PaymentNotReversibleError extends DomainError {
  readonly code = 'payment.not_reversible';
  readonly kind = 'conflict';
}

/** A void after a refund: refund the rest instead (P7). */
export class PaymentHasRefundsError extends DomainError {
  readonly code = 'payment.has_refunds';
  readonly kind = 'conflict';
}

/** The payer isn't one of the patient's billing contacts. */
export class PayerNotBillingContactError extends DomainError {
  readonly code = 'payment.invalid_payer';
  readonly kind = 'invalid';
}

export class InvalidPaymentCursorError extends DomainError {
  readonly code = 'payment.invalid_cursor';
  readonly kind = 'invalid';
}
