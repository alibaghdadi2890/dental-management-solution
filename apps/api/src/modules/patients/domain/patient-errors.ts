import { DomainError } from '../../../platform/kernel/domain-error';

export class PatientNotFoundError extends DomainError {
  readonly code = 'patient.not_found';
  readonly kind = 'not_found';
}

/** A mutation was attempted on an archived (soft-deleted) patient (design Q11). */
export class PatientArchivedError extends DomainError {
  readonly code = 'patient.archived';
  readonly kind = 'conflict';
}

/** Restoring a record that was merged away; it has `mergedIntoId` set (design Q11). */
export class PatientMergedError extends DomainError {
  readonly code = 'patient.merged';
  readonly kind = 'conflict';
}

/** `keepId` and `dropId` are the same patient. */
export class MergeSameError extends DomainError {
  readonly code = 'patient.merge_same';
  readonly kind = 'invalid';
}

/** `primaryDentistUserId` is not an active practitioner (`UsersService.listPractitioners`). */
export class UnknownDentistError extends DomainError {
  readonly code = 'patient.unknown_dentist';
  readonly kind = 'invalid';
}
