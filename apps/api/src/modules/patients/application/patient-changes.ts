import { type PatientPatch, type StoredPhone, storedPhone, type Tenant } from '@dcm/contracts';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { historyChanged } from '../domain/medical-history';
import type { MergePatch } from '../domain/merge';
import type { DomainPatient } from '../domain/patient';
import type { PatientPatch as PatientRecordPatch } from '../persistence/patients.repository';

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
  /** As stored (`storedPhone`), or null to clear. */
  phone?: StoredPhone | null;
}

/**
 * Stores `phone` against the tenant country — E.164 when valid, otherwise as typed; any patient
 * may have none (ADR-0052) — and checks that the date of birth is not after the tenant's `today`
 * (the contract only knows UTC, with a day of tolerance), as `ValidationFailedError`.
 */
export function normalizeFields(
  fields: TenantCheckedFields,
  country: Tenant['country'],
  today: string,
): NormalizedFields {
  const normalized: NormalizedFields = {};
  if (fields.phone !== undefined) {
    normalized.phone = fields.phone === null ? null : storedPhone(fields.phone, country);
  }
  if (fields.dateOfBirth && fields.dateOfBirth > today) {
    const message = 'Date of birth cannot be in the future';
    throw new ValidationFailedError('1 field is invalid', [
      { path: 'dateOfBirth', code: 'future_date', message },
    ]);
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
  'firstVisitType',
  'primaryDentistId',
  'notes',
] as const satisfies readonly (PatientPatchField & keyof PatientRecordPatch)[];

/**
 * The repository patch for the fields of `patch` whose stored value changes, and their names in
 * a stable order. Phones compare as stored, so a valid number typed in another format is no
 * change. An empty `fields` means the edit changes nothing.
 */
export function changesOf(
  before: DomainPatient,
  patch: PatientPatch,
  normalized: NormalizedFields,
): { set: PatientRecordPatch; fields: PatientPatchField[] } {
  const set: PatientRecordPatch = {};
  const fields: PatientPatchField[] = [];
  if (normalized.phone !== undefined && (normalized.phone?.value ?? null) !== before.phone) {
    set.phone = normalized.phone;
    fields.push('phone');
  }
  for (const field of PLAIN_FIELDS) {
    const value = patch[field];
    if (value === undefined || value === before[field]) continue;
    Object.assign(set, { [field]: value });
    fields.push(field);
  }
  if (patch.medicalHistory && historyChanged(before, patch.medicalHistory)) {
    set.medicalHistory = patch.medicalHistory;
    fields.push('medicalHistory');
  }
  return { set, fields };
}

/**
 * The merge patch as a repository patch. A stored phone is E.164 or the text as typed, and
 * storing it again yields the same value whatever the country; it is only needed for the search
 * digits. A null phone (the picked record had none) clears it.
 */
export function mergeSet(
  kept: DomainPatient,
  patch: MergePatch,
  country: Tenant['country'],
): PatientRecordPatch {
  const { phone, medication, medicalItems, ...fields } = patch;
  const rest: PatientRecordPatch = { ...fields };
  // The repository stores a history whole: the unioned items with the picked medication line.
  if (medication !== undefined || medicalItems !== undefined) {
    rest.medicalHistory = {
      ...(medicalItems ?? {
        noKnownAllergies: kept.noKnownAllergies,
        allergyIds: kept.allergies.map((item) => item.id),
        noConditions: kept.noConditions,
        conditionIds: kept.conditions.map((item) => item.id),
      }),
      medication: medication === undefined ? kept.medication : medication,
    };
  }
  if (phone === undefined) return rest;
  return { ...rest, phone: phone === null ? null : storedPhone(phone, country) };
}
