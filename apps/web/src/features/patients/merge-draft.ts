import {
  isMinor,
  type MedicalItem,
  MERGE_FIELDS,
  patientMergeSchema,
  type MergeField,
  type Patient,
  type PatientMerge,
  type PatientSex,
} from '@dcm/contracts';

export type MergeChoice = 'keep' | 'drop';

/**
 * The merge panel's working state (design "3-column compare grid… a radio per differing field").
 * `keepId` names which of `a`/`b` survives; `choices` holds a choice only for fields that actually
 * differ (a field both records already agree on has nothing to choose, per `differingFields`).
 */
export interface MergeDraft {
  a: Patient;
  b: Patient;
  keepId: string;
  choices: Partial<Record<MergeField, MergeChoice>>;
}

function displayNumberValue(displayNumber: string): number {
  return Number(displayNumber.slice(2));
}

/** The merge fields that are a property of the record itself (the medication line is part of
 * its medical history). */
type RecordMergeField = Exclude<MergeField, 'medication'>;

/** A record's value for a merge field. */
export function mergeValue(patient: Patient, field: MergeField) {
  return field === 'medication' ? patient.medicalHistory.medication : patient[field];
}

/** The pickable fields (`MERGE_FIELDS`) where the two records actually disagree — the only rows
 * the compare grid needs a radio for. */
export function differingFields(a: Patient, b: Patient): MergeField[] {
  return MERGE_FIELDS.filter((field) => mergeValue(a, field) !== mergeValue(b, field));
}

/**
 * Starts a merge draft for two duplicate records. `keepId` defaults to the older record — the one
 * with the lower display number (design "Keep ID choice"; compared numerically, not
 * lexicographically, so a 7-digit number after `P-999999` still sorts after every 6-digit one).
 * Every differing field defaults to `'keep'` (the survivor's own value); a field the schema would
 * default to `'keep'` anyway is still listed explicitly here so the compare grid has a radio
 * selection to render without special-casing "no choice yet".
 */
export function mergeDraft(a: Patient, b: Patient): MergeDraft {
  const keepId =
    displayNumberValue(a.displayNumber) <= displayNumberValue(b.displayNumber) ? a.id : b.id;
  const choices: Partial<Record<MergeField, MergeChoice>> = {};
  for (const field of differingFields(a, b)) {
    choices[field] = 'keep';
  }
  return { a, b, keepId, choices };
}

/**
 * Flips which record survives. Field choices are left untouched: `'keep'` always means "the
 * surviving record's own value", so flipping the survivor also flips what every still-default
 * field resolves to — the panel doesn't need to re-derive defaults, only re-render.
 */
export function swapKeep(draft: MergeDraft): MergeDraft {
  return { ...draft, keepId: draft.keepId === draft.a.id ? draft.b.id : draft.a.id };
}

function keptOf(draft: MergeDraft): Patient {
  return draft.keepId === draft.a.id ? draft.a : draft.b;
}

function droppedOf(draft: MergeDraft): Patient {
  return draft.keepId === draft.a.id ? draft.b : draft.a;
}

export interface MergePreview {
  fullName: string;
  /** Null when the picked record has none (a minor); the server refuses it for an adult. */
  phone: string | null;
  dateOfBirth: string | null;
  sex: PatientSex;
  email: string | null;
  address: string | null;
  insurance: string | null;
  medication: string | null;
  primaryDentistId: string | null;
  notes: string | null;
  /** The union of both records' allergies and of their conditions, by name, the kept record's
   * first: never a choice (ADR-0046), as the server's `resolveMerge` does it. */
  allergies: string[];
  conditions: string[];
}

/** Both records' items once each, the kept record's first. */
function unionNames(kept: readonly MedicalItem[], dropped: readonly MedicalItem[]): string[] {
  const names = new Map([...kept, ...dropped].map((item) => [item.id, item.name]));
  return [...names.values()];
}

/** The record the merge would produce, for the compare grid's "resulting value" column. */
export function preview(draft: MergeDraft): MergePreview {
  const kept = keptOf(draft);
  const dropped = droppedOf(draft);
  const source = (field: MergeField) => (draft.choices[field] === 'drop' ? dropped : kept);
  const pick = <K extends RecordMergeField>(field: K): Patient[K] => source(field)[field];

  return {
    fullName: pick('fullName'),
    phone: pick('phone'),
    dateOfBirth: pick('dateOfBirth'),
    sex: pick('sex'),
    email: pick('email'),
    address: pick('address'),
    insurance: pick('insurance'),
    medication: source('medication').medicalHistory.medication,
    primaryDentistId: pick('primaryDentistId'),
    notes: pick('notes'),
    allergies: unionNames(kept.medicalHistory.allergies, dropped.medicalHistory.allergies),
    conditions: unionNames(kept.medicalHistory.conditions, dropped.medicalHistory.conditions),
  };
}

/**
 * True when the merge would leave an adult without a phone — the server's phone rule (design
 * addendum C3), which refuses it with 422: the resolved phone is missing while the resolved date
 * of birth is not a minor's on the tenant's `today` (no date of birth = adult). Like the server,
 * only a merge that changes the survivor's phone or date of birth is checked, so a phoneless
 * patient who has since come of age can still be merged when neither changes.
 */
export function mergePhoneMissing(draft: MergeDraft, today: string): boolean {
  const kept = keptOf(draft);
  const result = preview(draft);
  const touched = result.phone !== kept.phone || result.dateOfBirth !== kept.dateOfBirth;
  if (!touched || result.phone !== null) return false;
  return result.dateOfBirth === null || !isMinor(result.dateOfBirth, today);
}

/**
 * Builds `POST /patients/merge`'s body. Reuses `patientMergeSchema` (rather than re-implementing
 * "reason is at least 3 trimmed characters") so the pure model can't drift from the one the server
 * enforces; an under-length or otherwise invalid reason throws (`ZodError`), which the merge panel
 * should never let happen by leaving Confirm disabled until a valid reason is typed, not by
 * catching this as a normal outcome.
 */
export function toMergePayload(draft: MergeDraft, reason: string): PatientMerge {
  const dropId = draft.keepId === draft.a.id ? draft.b.id : draft.a.id;
  return patientMergeSchema.parse({
    keepId: draft.keepId,
    dropId,
    fieldChoices: draft.choices,
    reason,
  });
}
