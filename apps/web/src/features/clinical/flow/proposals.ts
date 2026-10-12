import {
  type DiagnosisRecord,
  isOpenPlan,
  type PatientChart,
  type TreatmentPlan,
} from '@dcm/contracts';

/** A diagnosis the Plan step proposes treatment for, with what is already proposed for it. */
export interface Proposal {
  record: DiagnosisRecord;
  /** Recorded in this visit; else carried from "Open from before". */
  isNew: boolean;
  /** The open plans that treat it, in the order made. */
  plans: TreatmentPlan[];
}

const openPlansFor = (chart: PatientChart, recordId: string): TreatmentPlan[] =>
  chart.plans.filter((plan) => plan.diagnosisRecordId === recordId && isOpenPlan(plan));

/** This visit's diagnoses, in the order recorded: the Findings step's "Recorded today". */
export function recordedToday(chart: PatientChart, visitId: string): DiagnosisRecord[] {
  return chart.diagnoses.filter((record) => record.recordedInVisitId === visitId);
}

/**
 * "Open from before, not planned" (feature 10, V6): the active diagnoses recorded before this
 * visit that no open plan treats, or that only a plan of this visit does — those stay listed, as
 * "In today's plan".
 */
export function openFromBefore(chart: PatientChart, visitId: string): DiagnosisRecord[] {
  return chart.diagnoses.filter(
    (record) =>
      record.status === 'active' &&
      record.recordedInVisitId !== visitId &&
      openPlansFor(chart, record.id).every((plan) => plan.recordedInVisitId === visitId),
  );
}

/** Whether a diagnosis from before is in this visit's plan: carried here, or planned here. */
export function inTodaysPlan(
  chart: PatientChart,
  record: DiagnosisRecord,
  carried: ReadonlySet<string>,
): boolean {
  return carried.has(record.id) || openPlansFor(chart, record.id).length > 0;
}

/**
 * The Plan step's cards (V7): one per active diagnosis of this visit, then one per diagnosis
 * carried from before — by **Plan treatment →**, or by a plan this visit made for it. A
 * diagnosis is one card however it got there.
 */
export function proposals(
  chart: PatientChart,
  visitId: string,
  carried: ReadonlySet<string>,
): Proposal[] {
  const today = recordedToday(chart, visitId).filter((record) => record.status === 'active');
  const older = openFromBefore(chart, visitId).filter((record) =>
    inTodaysPlan(chart, record, carried),
  );
  return [...today, ...older].map((record) => ({
    record,
    isNew: record.recordedInVisitId === visitId,
    plans: openPlansFor(chart, record.id),
  }));
}

/**
 * The Plan step's **Other treatment** (V7): the open plans this visit made that are on none of
 * its cards — on a tooth without a diagnosis, on a jaw or on the whole mouth — in the order made.
 */
export function otherPlans(
  chart: PatientChart,
  visitId: string,
  cards: readonly Proposal[],
): TreatmentPlan[] {
  const onCards = new Set(cards.flatMap((card) => card.plans.map((plan) => plan.id)));
  return chart.plans.filter(
    (plan) => plan.recordedInVisitId === visitId && isOpenPlan(plan) && !onCards.has(plan.id),
  );
}
