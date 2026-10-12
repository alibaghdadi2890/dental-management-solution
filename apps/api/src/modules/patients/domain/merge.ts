import { MERGE_FIELDS, type MergeField } from '@dcm/contracts';
import { type MergedMedicalItems, mergeMedicalItems } from './medical-history';
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
    | 'medication'
    | 'primaryDentistId'
    | 'notes'
  >
> & {
  /** The unioned allergies and conditions, when they differ from the kept record's. */
  medicalItems?: MergedMedicalItems;
};

/** The fields a merge picks from one record or the other. */
type PickedKey = Exclude<keyof MergePatch, 'medicalItems'>;

/** Where each merge field lives on a `DomainPatient` (and, 1:1, on the `MergePatch`). */
const FIELD_KEYS: Record<MergeField, PickedKey> = {
  fullName: 'fullName',
  phone: 'phone',
  dateOfBirth: 'dateOfBirth',
  sex: 'sex',
  email: 'email',
  address: 'address',
  insurance: 'insurance',
  medication: 'medication',
  primaryDentistId: 'primaryDentistId',
  notes: 'notes',
};

/** Writes `patch[key] = value`, keeping `patch` and `value` tied to the same field (no `any`). */
function assign<K extends PickedKey>(patch: MergePatch, key: K, value: DomainPatient[K]) {
  patch[key] = value;
}

/**
 * Resolves a patient merge (design Q8, Q11): each pickable field comes from `kept` unless
 * `choices` says `'drop'`, in which case it comes from `dropped`; a missing choice means "keep"
 * (a phone may resolve to null: a minor recorded without one). Allergies and
 * conditions are always the union of both records (`mergeMedicalItems`, ADR-0046) — never a
 * field choice: a dropped allergy is a clinical risk. The medication line is picked like any
 * other field. Returns only the fields whose resolved value differs from `kept`'s own (the
 * audit's before/after shows what changed), so an all-kept merge with nothing to union produces
 * an empty patch.
 */
export function resolveMerge(
  kept: DomainPatient,
  dropped: DomainPatient,
  choices: Partial<Record<MergeField, 'keep' | 'drop'>>,
): MergePatch {
  const patch: MergePatch = {};

  for (const field of MERGE_FIELDS) {
    const key = FIELD_KEYS[field];
    const source = choices[field] === 'drop' ? dropped : kept;
    const value = source[key];
    if (value !== kept[key]) {
      assign(patch, key, value);
    }
  }

  const medicalItems = mergeMedicalItems(kept, dropped);
  if (medicalItems) patch.medicalItems = medicalItems;

  return patch;
}
