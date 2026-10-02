import { DomainError } from '../../../platform/kernel/domain-error';

/**
 * A visit with payments allocated to it can't be voided until they are refunded or moved
 * (4b, D19, ADR-0026). `billing` raises it inside the void transaction, which rolls the void
 * back. No payment can exist before feature 5, which makes this reachable.
 */
export class VisitHasPaymentsError extends DomainError {
  readonly code = 'visit.has_payments';
  readonly kind = 'conflict';
}
