import { ApiError } from '@/lib/api';
import { contactErrorField, type FormErrorKey, type FormField } from '../patient-form';

/** Every field an error can sit on: the form's own (a pending contact's by its index,
 * `contacts.<i>`) plus the dentist select (a server-only `patient.unknown_dentist`). */
export type ErrorField = FormField | 'primaryDentistId';
export type ErrorKey =
  | FormErrorKey
  | 'unknownDentist'
  | 'contactNotFound'
  | 'contactMerged'
  | 'contactDuplicate'
  | 'contactIsPatient';
export type FormErrors = Partial<Record<ErrorField, ErrorKey>>;

/** Problem `errors[].path` (`patient.`-prefixed on `POST /billing/opening-balances`) → field. */
const SERVER_FIELDS: Record<string, ErrorField> = {
  fullName: 'fullName',
  phone: 'phone',
  dateOfBirth: 'dateOfBirth',
  email: 'email',
  address: 'address',
  insurance: 'insurance',
  notes: 'notes',
  medicalAlerts: 'alerts',
  primaryDentistId: 'primaryDentistId',
  'openingBalance.amount': 'openingBalanceAmount',
  'openingBalance.asOf': 'openingBalanceAsOf',
  'openingBalance.note': 'openingBalanceNote',
};

/** The message a field gets for a server error; anything not listed reads "Check this value". */
const SERVER_ERROR_KEYS: Partial<Record<ErrorField, ErrorKey>> = {
  phone: 'invalidPhone',
  email: 'invalidEmail',
  openingBalanceAmount: 'invalidAmount',
};

function bareOf(path: string): string {
  return path.replace(/^patient\./, '');
}

function fieldOfPath(path: string): ErrorField | undefined {
  const bare = bareOf(path);
  return SERVER_FIELDS[bare] ?? (bare.startsWith('medicalAlerts.') ? 'alerts' : undefined);
}

const CONTACT_PATH = /^contacts\.(\d+)(?:\.(.+))?$/;

/**
 * A create's pending-contact error, from what follows `contacts.<i>` (design addendum C4, the
 * patients module doc's "Linking"): an unknown or merged-away target, an invalid new contact, no
 * role (the contract's refine sits on `isGuardian`), or the same contact twice (the server's
 * `duplicate` at `contacts.<i>`, the contract's refine at `contacts.<i>.target`).
 */
function contactErrorOf(rest: string | undefined, code: string): ErrorKey {
  if (rest === undefined) return code === 'duplicate' ? 'contactDuplicate' : 'invalid';
  if (rest === 'target') return code === 'custom' ? 'contactDuplicate' : 'invalid';
  if (rest === 'target.contactId' || rest === 'target.patientId') {
    if (code === 'not_found') return 'contactNotFound';
    if (code === 'merged') return 'contactMerged';
    return 'invalid';
  }
  if (rest === 'target.newContact.phone') return 'invalidPhone';
  if (rest === 'isGuardian') return 'roleRequired';
  return 'invalid';
}

/** `linkContactId`: an unknown contact, or (the contract's refine) one also linked as a contact. */
function linkContactErrorOf(code: string): ErrorKey {
  if (code === 'not_found') return 'contactNotFound';
  if (code === 'custom') return 'contactIsPatient';
  return 'invalid';
}

function fieldErrorOf(path: string, code: string): [ErrorField, ErrorKey] | undefined {
  const bare = bareOf(path);
  const contact = CONTACT_PATH.exec(bare);
  if (contact) return [contactErrorField(Number(contact[1])), contactErrorOf(contact[2], code)];
  if (bare === 'linkContactId') return ['linkContactId', linkContactErrorOf(code)];
  const field = fieldOfPath(path);
  if (!field) return undefined;
  // The phone rule (a missing phone for an adult) reads "Required", not "invalid number".
  if (field === 'phone' && code === 'required') return [field, 'required'];
  return [field, SERVER_ERROR_KEYS[field] ?? 'invalid'];
}

/** The field errors a failed save maps onto the form (the first per field), or `null` when it
 * isn't about a field. */
export function fieldErrorsOf(error: unknown): FormErrors | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'patient.unknown_dentist') return { primaryDentistId: 'unknownDentist' };
  const errors: FormErrors = {};
  for (const { path, code } of error.problem.errors ?? []) {
    const mapped = fieldErrorOf(path, code);
    if (!mapped) continue;
    const [field, key] = mapped;
    errors[field] ??= key;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export type PatientFailure =
  | 'archived'
  | 'merged'
  | 'alertsOverflow'
  | 'unknownDentist'
  | 'phoneRequired'
  | 'notFound'
  | 'conflict'
  | 'forbidden'
  | 'unexpected'
  | 'contactNotFound'
  | 'contactAlreadyLinked'
  | 'contactLinked'
  | 'contactConflict'
  | 'contactIsPatient'
  | 'contactRoleRequired'
  | 'contactPrimaryWithoutRole'
  | 'contactMerged'
  | 'contactInvalidPhone';

const FAILURES: Record<string, PatientFailure> = {
  'patient.archived': 'archived',
  'patient.merged': 'merged',
  'patient.merge_alerts_overflow': 'alertsOverflow',
  'patient.unknown_dentist': 'unknownDentist',
  'contact.not_found': 'contactNotFound',
  'contact.already_linked': 'contactAlreadyLinked',
  'contact.linked': 'contactLinked',
  'contact.conflict': 'contactConflict',
  'contact.is_patient': 'contactIsPatient',
  'contact.role_required': 'contactRoleRequired',
  'contact.primary_without_role': 'contactPrimaryWithoutRole',
};

const LINK_TARGET = /^(?:contacts\.\d+\.)?target\.(contactId|patientId|newContact\.phone)$/;

/** A contact action's 422 about its target (`target.…`, or `contacts.<i>.target.…` on a create):
 * merged away, unknown, or a new contact's invalid phone. */
function linkTargetFailure(
  issues: readonly { path: string; code: string }[],
): PatientFailure | undefined {
  for (const { path, code } of issues) {
    const target = LINK_TARGET.exec(bareOf(path))?.[1];
    if (target === undefined) continue;
    if (target === 'newContact.phone') return 'contactInvalidPhone';
    if (code === 'merged') return 'contactMerged';
    if (code === 'not_found') return 'contactNotFound';
  }
  return undefined;
}

/**
 * A failed patient save, merge or contact action as an i18n key (`patients:failures.<key>`), so
 * the person reads a message in their language rather than the server's English problem title:
 * the known `patient.*` and `contact.*` codes first (the contact routes', patients module doc
 * "Contacts"), then the phone rule (422 `validation_failed` at `phone`, code `required` — e.g. a
 * merge leaving an adult without a phone), then a contact action's target (422 at `target.…`:
 * merged away, unknown, an invalid new phone), then the status (404, 409, 403), else
 * `unexpected`.
 */
export function failureOf(error: unknown): PatientFailure {
  if (!(error instanceof ApiError)) return 'unexpected';
  const known = FAILURES[error.code];
  if (known) return known;
  if (error.code === 'validation_failed') {
    const issues = error.problem.errors ?? [];
    if (issues.some(({ path, code }) => fieldOfPath(path) === 'phone' && code === 'required')) {
      return 'phoneRequired';
    }
    const target = linkTargetFailure(issues);
    if (target) return target;
  }
  if (error.status === 404) return 'notFound';
  if (error.status === 409) return 'conflict';
  if (error.status === 403) return 'forbidden';
  return 'unexpected';
}
