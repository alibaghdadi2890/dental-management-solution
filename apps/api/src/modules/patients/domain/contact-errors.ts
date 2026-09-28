import { DomainError } from '../../../platform/kernel/domain-error';

/** The contact does not exist in this tenant, or is not linked to the patient in question. */
export class ContactNotFoundError extends DomainError {
  readonly code = 'contact.not_found';
  readonly kind = 'not_found';
}

/** The contact is already linked to this patient; change the existing link instead. */
export class ContactAlreadyLinkedError extends DomainError {
  readonly code = 'contact.already_linked';
  readonly kind = 'conflict';
}

/** A link must hold at least one role (guardian, billing, emergency; addendum C2). */
export class ContactRoleRequiredError extends DomainError {
  readonly code = 'contact.role_required';
  readonly kind = 'invalid';
}

/** A contact can only be a role's primary while holding that role (addendum C2). */
export class ContactPrimaryWithoutRoleError extends DomainError {
  readonly code = 'contact.primary_without_role';
  readonly kind = 'invalid';
}

/** The contact is (linked to) the patient itself: a patient is never their own contact (C2). */
export class ContactIsPatientError extends DomainError {
  readonly code = 'contact.is_patient';
  readonly kind = 'invalid';
}
