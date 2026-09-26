import { DomainError } from '../kernel/domain-error';

/** The actor lacks a permission (CLAUDE.md §6). The permission is internal detail, not echoed. */
export class PermissionDeniedError extends DomainError {
  readonly code = 'forbidden';
  readonly kind = 'forbidden';

  constructor(permission: string) {
    super('You do not have permission to perform this action', { permission });
  }
}
