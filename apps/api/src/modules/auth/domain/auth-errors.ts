import { AUTH_PROBLEM_CODES } from '@dcm/contracts';
import { DomainError, type DomainErrorKind } from '../../../platform/kernel/domain-error';

export class InvalidCredentialsError extends DomainError {
  readonly code = AUTH_PROBLEM_CODES.invalidCredentials;
  readonly kind = 'unauthenticated';
  override readonly extensions: { attemptsLeft: number };

  constructor(attemptsLeft: number) {
    super('Email or password is incorrect');
    this.extensions = { attemptsLeft };
  }
}

export class AccountLockedError extends DomainError {
  readonly code = AUTH_PROBLEM_CODES.accountLocked;
  readonly kind = 'unauthenticated';
  override readonly extensions: { lockedUntil: string };

  constructor(lockedUntil: Date) {
    super('Too many failed sign-in attempts; try again later');
    this.extensions = { lockedUntil: lockedUntil.toISOString() };
  }
}

export class AccountDeactivatedError extends DomainError {
  readonly code = AUTH_PROBLEM_CODES.accountDeactivated;
  readonly kind = 'forbidden';
}

export class SessionExpiredError extends DomainError {
  readonly code = AUTH_PROBLEM_CODES.sessionExpired;
  readonly kind = 'unauthenticated';
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'unauthenticated';
  readonly kind = 'unauthenticated';
}

export class PasswordChangeRequiredError extends DomainError {
  readonly code = AUTH_PROBLEM_CODES.passwordChangeRequired;
  readonly kind = 'forbidden';
}

export class NoTenantError extends DomainError {
  readonly code = AUTH_PROBLEM_CODES.noTenant;
  readonly kind = 'forbidden';
}

export class EmailTakenError extends DomainError {
  readonly code = 'user.email_taken';
  readonly kind = 'conflict';
}

export class BranchNotAssignedError extends DomainError {
  readonly code = 'session.branch_not_assigned';
  readonly kind = 'forbidden';
}

export class InvalidCurrentPasswordError extends DomainError {
  readonly code = 'auth.invalid_current_password';
  readonly kind = 'invalid';
}

/** Any other better-auth failure, surfaced as problem details with a stable `auth.*` code. */
export class AuthEndpointError extends DomainError {
  readonly kind: DomainErrorKind;

  constructor(
    readonly code: string,
    kind: DomainErrorKind,
    message: string,
  ) {
    super(message);
    this.kind = kind;
  }
}
