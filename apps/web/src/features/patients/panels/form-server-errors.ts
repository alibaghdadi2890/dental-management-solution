import { ApiError } from '@/lib/api';
import type { FormErrorKey, FormField } from '../patient-form';

/** Every field an error can sit on: the form's own plus the dentist select (a server-only
 * `patient.unknown_dentist`). */
export type ErrorField = FormField | 'primaryDentistUserId';
export type ErrorKey = FormErrorKey | 'invalid' | 'unknownDentist';
export type FormErrors = Partial<Record<ErrorField, ErrorKey>>;

/** Problem `errors[].path` (`patient.`-prefixed on `POST /billing/opening-balances`) → field. */
const SERVER_FIELDS: Record<string, ErrorField> = {
  fullName: 'fullName',
  phone: 'phone',
  dateOfBirth: 'dateOfBirth',
  email: 'email',
  address: 'address',
  insurance: 'insurance',
  emergencyContact: 'emergencyContact',
  notes: 'notes',
  guardianName: 'guardianName',
  guardianPhone: 'guardianPhone',
  medicalAlerts: 'alerts',
  primaryDentistUserId: 'primaryDentistUserId',
  'openingBalance.amount': 'openingBalanceAmount',
  'openingBalance.asOf': 'openingBalanceAsOf',
  'openingBalance.note': 'openingBalanceNote',
};

/** The message a field gets for a server error; anything not listed reads "Check this value". */
const SERVER_ERROR_KEYS: Partial<Record<ErrorField, ErrorKey>> = {
  phone: 'invalidPhone',
  guardianPhone: 'invalidPhone',
  email: 'invalidEmail',
  openingBalanceAmount: 'invalidAmount',
};

function fieldOfPath(path: string): ErrorField | undefined {
  const bare = path.replace(/^patient\./, '');
  return SERVER_FIELDS[bare] ?? (bare.startsWith('medicalAlerts.') ? 'alerts' : undefined);
}

/** The field errors a failed save maps onto the form, or `null` when it isn't about a field. */
export function fieldErrorsOf(error: unknown): FormErrors | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'patient.unknown_dentist') return { primaryDentistUserId: 'unknownDentist' };
  const errors: FormErrors = {};
  for (const { path } of error.problem.errors ?? []) {
    const field = fieldOfPath(path);
    if (field) errors[field] = SERVER_ERROR_KEYS[field] ?? 'invalid';
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export type PatientFailure =
  | 'archived'
  | 'merged'
  | 'alertsOverflow'
  | 'unknownDentist'
  | 'notFound'
  | 'conflict'
  | 'forbidden'
  | 'unexpected';

const FAILURES: Record<string, PatientFailure> = {
  'patient.archived': 'archived',
  'patient.merged': 'merged',
  'patient.merge_alerts_overflow': 'alertsOverflow',
  'patient.unknown_dentist': 'unknownDentist',
};

/**
 * A failed patient save or merge as an i18n key (`patients:failures.<key>`), so the person reads
 * a message in their language rather than the server's English problem title: the known
 * `patient.*` codes first, then the status (404, 409, 403), else `unexpected`.
 */
export function failureOf(error: unknown): PatientFailure {
  if (!(error instanceof ApiError)) return 'unexpected';
  const known = FAILURES[error.code];
  if (known) return known;
  if (error.status === 404) return 'notFound';
  if (error.status === 409) return 'conflict';
  if (error.status === 403) return 'forbidden';
  return 'unexpected';
}
