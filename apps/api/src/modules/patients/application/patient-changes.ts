import { isMinor, normalizePhone, type PatientPatch, type Tenant } from '@dcm/contracts';
import {
  type ValidationIssue,
  ValidationFailedError,
} from '../../../platform/kernel/validation-failed.error';
import type { MergePatch } from '../domain/merge';
import type { DomainPatient } from '../domain/patient';
import type {
  NormalizedPhoneInput,
  PatientPatch as PatientRecordPatch,
} from '../persistence/patients.repository';

/**
 * Pure rules between the contract and the repository: tenant-dependent field checks, the change
 * set of an edit and the repository patch of a merge. No I/O; the service supplies the tenant's
 * country and today.
 */

/** A field name of the edit contract, as listed in `PatientUpdated.fields`. */
export type PatientPatchField = keyof PatientPatch;

/** The editable fields every write re-checks against the tenant (country, time zone). */
export interface TenantCheckedFields {
  /** Raw text as typed, or null for "no phone"; `undefined` leaves the stored phone alone. */
  phone?: string | null | undefined;
  dateOfBirth?: string | null | undefined;
}

export interface NormalizedFields {
  /** Normalised against the tenant country, or null to clear. */
  phone?: NormalizedPhoneInput | null;
}

/** The stored values a patch is checked against by the phone rule; `null` on create. */
export type PhoneRuleBaseline = Pick<DomainPatient, 'phone' | 'dateOfBirth'> | null;

function invalidPhone(): ValidationIssue {
  return { path: 'phone', code: 'invalid_phone', message: 'Not a valid phone number' };
}

/**
 * The phone rule (design addendum C3): a phone is required unless the date of birth makes the
 * patient a minor on the tenant's `today` (no date of birth = adult). On create (`before` null)
 * it always applies. On an edit or merge it applies only when the change touches the phone or
 * the date of birth — clearing an adult's phone, or giving a phoneless minor an adult date of
 * birth — so a minor who has since come of age can still be edited without adding a phone first.
 */
function phoneRuleIssue(
  change: TenantCheckedFields,
  before: PhoneRuleBaseline,
  today: string,
): ValidationIssue | null {
  if (before !== null && change.phone === undefined && change.dateOfBirth === undefined) {
    return null;
  }
  const phone = change.phone === undefined ? (before?.phone ?? null) : change.phone;
  const dateOfBirth =
    change.dateOfBirth === undefined ? (before?.dateOfBirth ?? null) : change.dateOfBirth;
  if (phone !== null) return null;
  if (dateOfBirth !== null && isMinor(dateOfBirth, today)) return null;
  return { path: 'phone', code: 'required', message: 'A phone number is required for adults' };
}

function validationFailed(issues: ValidationIssue[]): ValidationFailedError {
  return new ValidationFailedError(
    issues.length === 1 ? '1 field is invalid' : `${issues.length} fields are invalid`,
    issues,
  );
}

/**
 * Normalises `phone` against the tenant country, checks that the date of birth is not after the
 * tenant's `today` (the contract only knows UTC, with a day of tolerance) and applies the phone
 * rule (`phoneRuleIssue`) against `before` (null on create). Every failure is reported at once as
 * `ValidationFailedError`, addressed by field.
 */
export function normalizeFields(
  fields: TenantCheckedFields,
  country: Tenant['country'],
  today: string,
  before: PhoneRuleBaseline,
): NormalizedFields {
  const issues: ValidationIssue[] = [];
  const normalized: NormalizedFields = {};
  if (fields.phone === null) {
    normalized.phone = null;
  } else if (fields.phone !== undefined) {
    const phone = normalizePhone(fields.phone, country);
    if (phone) normalized.phone = phone;
    else issues.push(invalidPhone());
  }
  if (issues.length === 0) {
    const required = phoneRuleIssue(fields, before, today);
    if (required) issues.push(required);
  }
  if (fields.dateOfBirth && fields.dateOfBirth > today) {
    issues.push({
      path: 'dateOfBirth',
      code: 'future_date',
      message: 'Date of birth cannot be in the future',
    });
  }
  if (issues.length > 0) throw validationFailed(issues);
  return normalized;
}

/** A merge that leaves an adult without a phone breaks the same rule (`phoneRuleIssue`). */
export function assertMergePhoneRule(kept: DomainPatient, patch: MergePatch, today: string): void {
  const issue = phoneRuleIssue({ phone: patch.phone, dateOfBirth: patch.dateOfBirth }, kept, today);
  if (issue) throw validationFailed([issue]);
}

/** Patch fields stored as given (no normalisation, plain equality). */
const PLAIN_FIELDS = [
  'fullName',
  'dateOfBirth',
  'sex',
  'email',
  'address',
  'insurance',
  'primaryDentistId',
  'notes',
] as const satisfies readonly (PatientPatchField & keyof PatientRecordPatch)[];

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The repository patch for the fields of `patch` whose stored value changes, and their names in
 * a stable order. Phones compare by E.164, so the same number typed in another format is no
 * change. An empty `fields` means the edit changes nothing.
 */
export function changesOf(
  before: DomainPatient,
  patch: PatientPatch,
  normalized: NormalizedFields,
): { set: PatientRecordPatch; fields: PatientPatchField[] } {
  const set: PatientRecordPatch = {};
  const fields: PatientPatchField[] = [];
  if (normalized.phone !== undefined && (normalized.phone?.e164 ?? null) !== before.phone) {
    set.phone = normalized.phone;
    fields.push('phone');
  }
  for (const field of PLAIN_FIELDS) {
    const value = patch[field];
    if (value === undefined || value === before[field]) continue;
    Object.assign(set, { [field]: value });
    fields.push(field);
  }
  if (patch.medicalAlerts && !sameList(patch.medicalAlerts, before.medicalAlerts)) {
    set.medicalAlerts = patch.medicalAlerts;
    fields.push('medicalAlerts');
  }
  return { set, fields };
}

/**
 * The merge patch as a repository patch. A stored phone is E.164 (leading `+`), so re-parsing it
 * yields the same number whatever the country; it is only needed for the national search digits.
 * A null phone (the picked record had none) clears it.
 */
export function mergeSet(patch: MergePatch, country: Tenant['country']): PatientRecordPatch {
  const { phone, ...rest } = patch;
  if (phone === undefined) return rest;
  if (phone === null) return { ...rest, phone: null };
  const normalized = normalizePhone(phone, country);
  if (!normalized) throw new Error('merge: a stored phone is not a valid E.164 number');
  return { ...rest, phone: normalized };
}
