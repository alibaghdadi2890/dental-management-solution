import type { MedicalHistoryInput, MedicalItem, MedicalOptionKind } from '@dcm/contracts';
import type { ValidationIssue } from '../../../platform/kernel/validation-failed.error';

/**
 * A patient's medical history as stored (feature 10, ADR-0046): for each of the two lists the
 * items picked and whether "none" was the answer, plus the medication line. A list with no items
 * and no flag was never asked.
 */
export interface StoredMedicalHistory {
  noKnownAllergies: boolean;
  allergies: MedicalItem[];
  noConditions: boolean;
  conditions: MedicalItem[];
  medication: string | null;
}

/** The lists a new clinic starts with; ordinary rows afterwards. */
export const DEFAULT_MEDICAL_OPTIONS: Readonly<Record<MedicalOptionKind, readonly string[]>> = {
  allergy: ['Penicillin', 'Latex', 'Local anaesthetic', 'NSAIDs', 'Chlorhexidine'],
  condition: [
    'Hypertension',
    'Diabetes',
    'Pregnant',
    'Anticoagulants',
    'Heart condition',
    'Asthma',
  ],
};

/** A row of a clinic's lists, as the history rules need it. */
export interface KnownOption {
  id: string;
  kind: MedicalOptionKind;
  active: boolean;
}

const LISTS = [
  { kind: 'allergy', field: 'allergyIds', stored: 'allergies' },
  { kind: 'condition', field: 'conditionIds', stored: 'conditions' },
] as const;

/**
 * What is wrong with a history about to be stored: an id that is not an option of its list, or
 * an inactive option the patient does not already have (one they have stays). `known` are the
 * clinic's options among the ids sent; `before` is the stored history, null on create.
 */
export function historyIssues(
  input: MedicalHistoryInput,
  known: readonly KnownOption[],
  before: StoredMedicalHistory | null,
): ValidationIssue[] {
  const byId = new Map(known.map((option) => [option.id, option]));
  const issues: ValidationIssue[] = [];
  for (const { kind, field, stored } of LISTS) {
    const had = new Set(before?.[stored].map((item) => item.id));
    input[field].forEach((id, index) => {
      const option = byId.get(id);
      const path = `medicalHistory.${field}.${String(index)}`;
      if (option?.kind !== kind) {
        issues.push({ path, code: 'unknown_option', message: 'Not an item of this list' });
      } else if (!option.active && !had.has(id)) {
        issues.push({ path, code: 'inactive_option', message: 'This item is no longer offered' });
      }
    });
  }
  return issues;
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Whether storing `input` over `before` changes anything. */
export function historyChanged(before: StoredMedicalHistory, input: MedicalHistoryInput): boolean {
  return (
    before.noKnownAllergies !== input.noKnownAllergies ||
    before.noConditions !== input.noConditions ||
    before.medication !== input.medication ||
    !sameIds(
      before.allergies.map((item) => item.id),
      input.allergyIds,
    ) ||
    !sameIds(
      before.conditions.map((item) => item.id),
      input.conditionIds,
    )
  );
}

/** The two lists of a merge, without the medication line (a field choice of its own). */
export type MergedMedicalItems = Pick<
  MedicalHistoryInput,
  'noKnownAllergies' | 'allergyIds' | 'noConditions' | 'conditionIds'
>;

const union = (kept: readonly MedicalItem[], dropped: readonly MedicalItem[]) => [
  ...new Set([...kept, ...dropped].map((item) => item.id)),
];

/**
 * The allergies and conditions of a merged record (ADR-0046): the union of both records' items,
 * the kept record's first. Never a choice: losing an allergy in a merge is the worse mistake.
 * "None" survives only where neither record lists anything; null when the kept record already
 * holds the result.
 */
export function mergeMedicalItems(
  kept: StoredMedicalHistory,
  dropped: StoredMedicalHistory,
): MergedMedicalItems | null {
  const allergyIds = union(kept.allergies, dropped.allergies);
  const conditionIds = union(kept.conditions, dropped.conditions);
  const merged: MergedMedicalItems = {
    allergyIds,
    noKnownAllergies:
      allergyIds.length === 0 && (kept.noKnownAllergies || dropped.noKnownAllergies),
    conditionIds,
    noConditions: conditionIds.length === 0 && (kept.noConditions || dropped.noConditions),
  };
  return historyChanged(kept, { ...merged, medication: kept.medication }) ? merged : null;
}
