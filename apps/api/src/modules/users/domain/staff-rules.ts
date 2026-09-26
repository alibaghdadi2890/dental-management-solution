import { DomainError } from '../../../platform/kernel/domain-error';

export class StaffUserNotFoundError extends DomainError {
  readonly code = 'user.not_found';
  readonly kind = 'not_found';
}

export class LastOwnerError extends DomainError {
  readonly code = 'user.last_owner';
  readonly kind = 'conflict';
}

export class SelfDeactivationError extends DomainError {
  readonly code = 'user.self_deactivation';
  readonly kind = 'conflict';
}

export class RoleRequiredError extends DomainError {
  readonly code = 'user.role_required';
  readonly kind = 'invalid';
}

export class BranchRequiredError extends DomainError {
  readonly code = 'user.branch_required';
  readonly kind = 'invalid';
}

/** A branch id that is not an (active) branch of this clinic. */
export class UnknownBranchError extends DomainError {
  readonly code = 'user.unknown_branch';
  readonly kind = 'invalid';
}

/** A clinic always keeps at least one active owner (someone must be able to manage it later, D1). */
export function assertKeepsAnOwner(activeOwnerIds: readonly string[], leavingUserId: string): void {
  if (activeOwnerIds.includes(leavingUserId) && activeOwnerIds.length <= 1) {
    throw new LastOwnerError('The clinic must keep at least one active owner');
  }
}

export function assertNotSelf(actorUserId: string | undefined, targetUserId: string): void {
  if (actorUserId === targetUserId) {
    throw new SelfDeactivationError('You cannot deactivate your own account');
  }
}

/** Every staff user holds at least one role and works in at least one branch. */
export function assertAssignments(change: {
  roleKeys?: readonly string[] | undefined;
  branchIds?: readonly string[] | undefined;
}): void {
  if (change.roleKeys?.length === 0) {
    throw new RoleRequiredError('Assign at least one role');
  }
  if (change.branchIds?.length === 0) {
    throw new BranchRequiredError('Assign at least one branch');
  }
}
