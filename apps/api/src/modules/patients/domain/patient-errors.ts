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

/**
 * `primaryDentistId` is not the staff profile id of an active practitioner
 * (`UsersService.listPractitioners`, ADR-0020).
 */
export class UnknownDentistError extends DomainError {
  readonly code = 'patient.unknown_dentist';
  readonly kind = 'invalid';
}

/**
 * The unioned medical alerts of a merge exceed `MEDICAL_ALERTS_MAX` (`@dcm/contracts`). Alerts are
 * never truncated (a dropped allergy is a clinical risk, design Q8): the caller must remove some
 * alerts from one of the two records before merging.
 */
export class MergeAlertsOverflowError extends DomainError {
  readonly code = 'patient.merge_alerts_overflow';
  readonly kind = 'invalid';
}
