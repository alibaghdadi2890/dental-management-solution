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

/** An `Idempotency-Key` replayed with a different request (feature 7, H5). */
export class PatientIdempotencyMismatchError extends DomainError {
  readonly code = 'patient.idempotency_mismatch';
  readonly kind = 'conflict';
}

/** `keepId` and `dropId` are the same patient. */
export class MergeSameError extends DomainError {
  readonly code = 'patient.merge_same';
  readonly kind = 'invalid';
}

/**
 * `primaryDentistId` is not the staff profile id of an active practitioner
 * (`UsersService.listPractitioners`, ADR-0020).
 */
export class UnknownDentistError extends DomainError {
  readonly code = 'patient.unknown_dentist';
  readonly kind = 'invalid';
}

/** A list option that a patient's history uses can only be deactivated (feature 10, ADR-0046). */
export class MedicalOptionInUseError extends DomainError {
  readonly code = 'medical_option.in_use';
  readonly kind = 'conflict';
}

export class MedicalOptionNotFoundError extends DomainError {
  readonly code = 'medical_option.not_found';
  readonly kind = 'not_found';
}
