import { normalizePhone, type PatientPatch, type Tenant } from '@dcm/contracts';
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
  phone?: string | undefined;
  guardianPhone?: string | null | undefined;
  dateOfBirth?: string | null | undefined;
}

export interface NormalizedFields {
  phone?: NormalizedPhoneInput;
  /** E.164, or null to clear. */
  guardianPhone?: string | null;
}

function invalidPhone(path: 'phone' | 'guardianPhone'): ValidationIssue {
  return { path, code: 'invalid_phone', message: 'Not a valid phone number' };
}

/**
 * Normalises `phone`/`guardianPhone` against the tenant country and checks that the date of
 * birth is not after the tenant's `today` (the contract only knows UTC, with a day of
 * tolerance). Every failure is reported at once as `ValidationFailedError`, addressed by field.
 */
export function normalizeFields(
  fields: TenantCheckedFields,
  country: Tenant['country'],
  today: string,
): NormalizedFields {
  const issues: ValidationIssue[] = [];
  const normalized: NormalizedFields = {};
  if (fields.phone !== undefined) {
    const phone = normalizePhone(fields.phone, country);
    if (phone) normalized.phone = phone;
    else issues.push(invalidPhone('phone'));
  }
  if (fields.guardianPhone === null) {
    normalized.guardianPhone = null;
  } else if (fields.guardianPhone !== undefined) {
    const guardianPhone = normalizePhone(fields.guardianPhone, country);
    if (guardianPhone) normalized.guardianPhone = guardianPhone.e164;
    else issues.push(invalidPhone('guardianPhone'));
  }
  if (fields.dateOfBirth && fields.dateOfBirth > today) {
    issues.push({
      path: 'dateOfBirth',
      code: 'future_date',
      message: 'Date of birth cannot be in the future',
    });
  }
  if (issues.length > 0) {
    throw new ValidationFailedError(
      issues.length === 1 ? '1 field is invalid' : `${issues.length} fields are invalid`,
      issues,
    );
  }
  return normalized;
}

/** Patch fields stored as given (no normalisation, plain equality). */
const PLAIN_FIELDS = [
  'fullName',
  'dateOfBirth',
  'sex',
  'email',
  'address',
  'insurance',
  'emergencyContact',
  'primaryDentistUserId',
  'notes',
  'guardianName',
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
  if (normalized.phone && normalized.phone.e164 !== before.phone) {
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
  if (normalized.guardianPhone !== undefined && normalized.guardianPhone !== before.guardianPhone) {
    set.guardianPhone = normalized.guardianPhone;
    fields.push('guardianPhone');
  }
  return { set, fields };
}

/**
 * The merge patch as a repository patch. A stored phone is E.164 (leading `+`), so re-parsing it
 * yields the same number whatever the country; it is only needed for the national search digits.
 */
export function mergeSet(patch: MergePatch, country: Tenant['country']): PatientRecordPatch {
  const { phone, ...rest } = patch;
  if (phone === undefined) return rest;
  const normalized = normalizePhone(phone, country);
  if (!normalized) throw new Error('merge: a stored phone is not a valid E.164 number');
  return { ...rest, phone: normalized };
}
