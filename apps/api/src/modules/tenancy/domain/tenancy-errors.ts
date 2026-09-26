import { AUTH_PROBLEM_CODES } from '@dcm/contracts';
import { DomainError } from '../../../platform/kernel/domain-error';

export class TenantNotFoundError extends DomainError {
  readonly code = 'tenant.not_found';
  readonly kind = 'not_found';
}

export class TenantSlugTakenError extends DomainError {
  readonly code = 'tenant.slug_taken';
  readonly kind = 'conflict';
}

export class TenantSuspendedError extends DomainError {
  readonly code = AUTH_PROBLEM_CODES.tenantSuspended;
  readonly kind = 'forbidden';
}

export class BranchNotFoundError extends DomainError {
  readonly code = 'branch.not_found';
  readonly kind = 'not_found';
}

export class BranchNameTakenError extends DomainError {
  readonly code = 'branch.name_taken';
  readonly kind = 'conflict';
}

export class BranchCodeTakenError extends DomainError {
  readonly code = 'branch.code_taken';
  readonly kind = 'conflict';
}

export class RoomNotFoundError extends DomainError {
  readonly code = 'room.not_found';
  readonly kind = 'not_found';
}

export class RoomNameTakenError extends DomainError {
  readonly code = 'room.name_taken';
  readonly kind = 'conflict';
}

export class RoomCodeTakenError extends DomainError {
  readonly code = 'room.code_taken';
  readonly kind = 'conflict';
}

/** Rooms stay in the branch they were created in; a move would rewrite visit history later. */
export class RoomBranchChangeError extends DomainError {
  readonly code = 'room.branch_change';
  readonly kind = 'invalid';
}
