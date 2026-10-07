import { DomainError } from '../../../platform/kernel/domain-error';

/**
 * An `Idempotency-Key` of an opening balance or an adjustment replayed with a different request
 * (feature 7, H5). Payments have their own (`payment.idempotency_mismatch`).
 */
export class LedgerIdempotencyMismatchError extends DomainError {
  readonly code = 'ledger.idempotency_mismatch';
  readonly kind = 'conflict';
}

/**
 * The tenant has money recorded, so its currency can no longer change (feature 7, H6, ADR-0035).
 * `billing` raises it inside `tenancy`'s settings transaction, which rolls the change back.
 */
export class TenantCurrencyLockedError extends DomainError {
  readonly code = 'tenant.currency_locked';
  readonly kind = 'invalid';
}
