import { DomainError } from '../../../platform/kernel/domain-error';

/** A role key that does not exist in the tenant. */
export class UnknownRoleError extends DomainError {
  readonly code = 'role.unknown';
  readonly kind = 'invalid';
}
