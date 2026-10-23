import { DomainError } from '../../../platform/kernel/domain-error';

/** A role key that does not exist in the tenant, or a deactivated role being assigned. */
export class UnknownRoleError extends DomainError {
  readonly code = 'role.unknown';
  readonly kind = 'invalid';
}

export class RoleNotFoundError extends DomainError {
  readonly code = 'role.not_found';
  readonly kind = 'not_found';
}

/** The editor would give a permission they do not hold (ADR-0055); `permission` names it. */
export class CannotGrantError extends DomainError {
  readonly code = 'role.cannot_grant';
  readonly kind = 'forbidden';
  override readonly extensions: { permission: string };

  constructor(permission: string) {
    super(`You cannot grant ${permission}: you do not hold it`);
    this.extensions = { permission };
  }
}

/**
 * The target holds what the editor does not (or is an owner the editor is not): changing their
 * account — password, status, profile, roles — would hand the editor more than they hold.
 */
export class CannotManageError extends DomainError {
  readonly code = 'role.cannot_manage';
  readonly kind = 'forbidden';
  override readonly extensions: { permission: string };

  constructor(permission: string) {
    super(`You cannot manage someone who holds ${permission} when you do not`);
    this.extensions = { permission };
  }
}

/** The change would take away the caller's own `role:write` or `user:write`. */
export class SelfLockoutError extends DomainError {
  readonly code = 'role.self_lockout';
  readonly kind = 'conflict';
  override readonly extensions: { permission: string };

  constructor(permission: string) {
    super(`This change would remove your own ${permission}`);
    this.extensions = { permission };
  }
}

/** The owner role always holds every permission and cannot be edited. */
export class OwnerLockedError extends DomainError {
  readonly code = 'role.owner_locked';
  readonly kind = 'conflict';
}

/** A role still held by users cannot be deactivated; `holders` says by how many. */
export class RoleHasHoldersError extends DomainError {
  readonly code = 'role.has_holders';
  readonly kind = 'conflict';
  override readonly extensions: { holders: number };

  constructor(holders: number) {
    super(`The role is held by ${holders} user(s)`);
    this.extensions = { holders };
  }
}

/** Only a custom role is renamed, described, deactivated or reactivated; only a system role is
 * reset to its default. */
export class RoleKindError extends DomainError {
  readonly code = 'role.not_allowed';
  readonly kind = 'conflict';
}
