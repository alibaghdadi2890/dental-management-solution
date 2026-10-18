import {
  type DiagnosisRecord,
  type MissingInformation,
  type Money,
  type PatientChart,
  planPhases,
  type TreatmentPlan,
} from '@dcm/contracts';

/**
 * One row of the Overview's **Needs attention** card (feature 10, V11), in the order the card
 * lists them: work in progress to continue, an urgent plan the patient accepted that is not done,
 * money owed, a patient who was never examined here, and important details the record lacks
 * (ADR-0052).
 */
export type AttentionItem =
  | { kind: 'continue'; plan: TreatmentPlan }
  | { kind: 'treat'; plan: TreatmentPlan; diagnosis: DiagnosisRecord | undefined }
  | { kind: 'balance'; owed: Money }
  | { kind: 'examination' }
  | { kind: 'details'; missing: MissingInformation[] };

export interface AttentionFacts {
  /** Undefined until the chart is in (or without `visit:read`): no plan rows. */
  chart: PatientChart | undefined;
  /** What the patient owes, when it is more than nothing; null otherwise or when unknown. */
  owed: Money | null;
  /** Whether the patient has a completed visit; undefined while unknown. */
  hasVisits: boolean | undefined;
  /** The important fields the record lacks (`missingInformation`); undefined while unknown. */
  missing: MissingInformation[] | undefined;
}

/**
 * What needs attention on a patient's record. Pure: every card that names a next step for the
 * patient reads the same list. Empty means "Nothing needs attention".
 */
export function needsAttention({
  chart,
  owed,
  hasVisits,
  missing,
}: AttentionFacts): AttentionItem[] {
  const phases = planPhases(chart?.plans ?? []);
  const open = phases.flatMap((phase) => phase.open);
  const urgent = phases.find((phase) => phase.priority === 'urgent')?.open ?? [];
  return [
    ...open
      .filter((plan) => plan.status === 'in_progress')
      .map((plan): AttentionItem => ({ kind: 'continue', plan })),
    ...urgent
      .filter((plan) => plan.status === 'planned' && plan.acceptedAt !== null)
      .map((plan): AttentionItem => ({
        kind: 'treat',
        plan,
        diagnosis: chart?.diagnoses.find((record) => record.id === plan.diagnosisRecordId),
      })),
    ...(owed ? [{ kind: 'balance', owed } satisfies AttentionItem] : []),
    ...(hasVisits === false ? [{ kind: 'examination' } satisfies AttentionItem] : []),
    ...(missing && missing.length > 0
      ? [{ kind: 'details', missing } satisfies AttentionItem]
      : []),
  ];
}
