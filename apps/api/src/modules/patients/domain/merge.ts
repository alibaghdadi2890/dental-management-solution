import { dedupeAlerts, MEDICAL_ALERTS_MAX, MERGE_FIELDS, type MergeField } from '@dcm/contracts';
import { MergeAlertsOverflowError } from './patient-errors';
import type { DomainPatient } from './patient';

/** The patch `resolveMerge` writes onto the kept record; only the fields that actually change. */
export type MergePatch = Partial<
  Pick<
    DomainPatient,
    | 'fullName'
    | 'phone'
    | 'dateOfBirth'
    | 'sex'
    | 'email'
    | 'address'
    | 'insurance'
    | 'emergencyContact'
    | 'primaryDentistUserId'
    | 'notes'
    | 'guardianName'
    | 'guardianPhone'
    | 'medicalAlerts'
  >
>;

/** The scalar merge fields, i.e. every `MergeField` except `guardian` (which moves a pair). */
type ScalarMergeField = Exclude<MergeField, 'guardian'>;

/** Where each scalar merge field lives on a `DomainPatient` (and, 1:1, on the `MergePatch`). */
const SCALAR_FIELD_KEYS: Record<ScalarMergeField, keyof MergePatch> = {
  fullName: 'fullName',
  phone: 'phone',
  dateOfBirth: 'dateOfBirth',
  sex: 'sex',
  email: 'email',
  address: 'address',
  insurance: 'insurance',
  emergencyContact: 'emergencyContact',
  primaryDentistUserId: 'primaryDentistUserId',
  notes: 'notes',
};

/** Writes `patch[key] = value`, keeping `patch` and `value` tied to the same field (no `any`). */
function assign<K extends keyof MergePatch>(patch: MergePatch, key: K, value: DomainPatient[K]) {
  patch[key] = value;
}

function sameAlerts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Resolves a patient merge (design Q8, Q11): each pickable field comes from `kept` unless
 * `choices` says `'drop'`, in which case it comes from `dropped`; a missing choice means "keep".
 * `guardian` moves `guardianName`/`guardianPhone` together as one choice. Medical alerts are
 * always the case-insensitive union of both records (kept's own alerts first) — never a field
 * choice, and never truncated: a dropped allergy is a clinical risk, so a union bigger than
 * `MEDICAL_ALERTS_MAX` throws `MergeAlertsOverflowError` rather than silently losing alerts;
 * the caller must remove some first. Returns only the fields whose resolved value differs from
 * `kept`'s own (the audit's before/after shows what changed), so an all-kept merge with an unchanged alert union produces an empty patch.
 */
export function resolveMerge(
  kept: DomainPatient,
  dropped: DomainPatient,
  choices: Partial<Record<MergeField, 'keep' | 'drop'>>,
): MergePatch {
  const patch: MergePatch = {};

  for (const field of MERGE_FIELDS) {
    if (field === 'guardian') continue;
    const key = SCALAR_FIELD_KEYS[field];
    const source = choices[field] === 'drop' ? dropped : kept;
    const value = source[key];
    if (value !== kept[key]) {
      assign(patch, key, value);
    }
  }

  const guardianSource = choices.guardian === 'drop' ? dropped : kept;
  if (
    guardianSource.guardianName !== kept.guardianName ||
    guardianSource.guardianPhone !== kept.guardianPhone
  ) {
    patch.guardianName = guardianSource.guardianName;
    patch.guardianPhone = guardianSource.guardianPhone;
  }

  const unionAlerts = dedupeAlerts([...kept.medicalAlerts, ...dropped.medicalAlerts]);
  if (unionAlerts.length > MEDICAL_ALERTS_MAX) {
    throw new MergeAlertsOverflowError(
      `Merging would leave ${unionAlerts.length} medical alerts, more than the ${MEDICAL_ALERTS_MAX} allowed; remove some alerts before merging`,
    );
  }
  if (!sameAlerts(unionAlerts, kept.medicalAlerts)) {
    patch.medicalAlerts = unionAlerts;
  }

  return patch;
}
