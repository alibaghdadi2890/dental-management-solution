import { MERGE_FIELDS, type MergeField } from '@dcm/contracts';
import type { DomainPatient } from './patient';

const MEDICAL_ALERTS_MAX = 20;

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

export interface MergeResolution {
  patch: MergePatch;
  /** The pickable fields (design Q8: `medicalAlerts` is unioned, never a choice) that changed. */
  changedFields: MergeField[];
}

/**
 * Case- and normalization-insensitive de-dupe (NFKC-folded, lower-cased), keeping the first
 * occurrence — the same semantics `medicalAlertsSchema` uses in `@dcm/contracts`, reimplemented
 * here so `domain/` stays free of a runtime dependency on that package's internal (non-exported)
 * helper (CLAUDE.md §4.5).
 */
function dedupeAlertsCaseInsensitive(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.normalize('NFKC').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function sameAlerts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Resolves a patient merge (design Q8, Q11): each pickable field comes from `kept` unless
 * `choices` says `'drop'`, in which case it comes from `dropped`; a missing choice means "keep".
 * `guardian` moves `guardianName`/`guardianPhone` together as one choice. Medical alerts are
 * always the case-insensitive union of both records (kept's own alerts first), capped at 20 —
 * never a field choice. Returns only the fields whose resolved value differs from `kept`'s own,
 * so an all-kept merge with unchanged alerts produces an empty patch.
 */
export function resolveMerge(
  kept: DomainPatient,
  dropped: DomainPatient,
  choices: Partial<Record<MergeField, 'keep' | 'drop'>>,
): MergeResolution {
  const patch: MergePatch = {};
  const changedFields: MergeField[] = [];

  for (const field of MERGE_FIELDS) {
    if (field === 'guardian') continue;
    const key = SCALAR_FIELD_KEYS[field];
    const source = choices[field] === 'drop' ? dropped : kept;
    const value = source[key];
    if (value !== kept[key]) {
      assign(patch, key, value);
      changedFields.push(field);
    }
  }

  const guardianSource = choices.guardian === 'drop' ? dropped : kept;
  if (
    guardianSource.guardianName !== kept.guardianName ||
    guardianSource.guardianPhone !== kept.guardianPhone
  ) {
    patch.guardianName = guardianSource.guardianName;
    patch.guardianPhone = guardianSource.guardianPhone;
    changedFields.push('guardian');
  }

  const unionAlerts = dedupeAlertsCaseInsensitive([
    ...kept.medicalAlerts,
    ...dropped.medicalAlerts,
  ]).slice(0, MEDICAL_ALERTS_MAX);
  if (!sameAlerts(unionAlerts, kept.medicalAlerts)) {
    patch.medicalAlerts = unionAlerts;
  }

  return { patch, changedFields };
}
