import {
  NO_FLOW_FACTS,
  type PatientChart,
  type TreatmentPlan,
  type Visit,
  type VisitFlowFacts,
} from '@dcm/contracts';

/** Whether this visit worked on the plan: performed it, or logged a session on it. */
const touchedIn = (plan: TreatmentPlan, visitId: string): boolean =>
  plan.performedInVisitId === visitId ||
  plan.sessions.some((session) => session.visitId === visitId);

/** Which of the plan's sessions this visit is: the one it logged, else the next one. */
export function sessionNumberIn(plan: TreatmentPlan, visitId: string): number {
  const logged = plan.sessions.findIndex((session) => session.visitId === visitId);
  return logged < 0 ? plan.sessions.length + 1 : logged + 1;
}

/**
 * What a visit holds, as its steps count it (`VisitFlowFacts`, ADR-0044): read from the visit,
 * the patient's chart and the number of files linked to the visit. Without the chart only what
 * the visit itself says is known.
 */
export function visitFlowFacts(
  visit: Visit,
  chart: PatientChart | undefined,
  files: number,
): VisitFlowFacts {
  const here = (visitId: string | null) => visitId === visit.id;
  const plans = chart?.plans ?? [];
  const worked = new Set(plans.filter((plan) => touchedIn(plan, visit.id)).map((plan) => plan.id));
  // A session of work this visit did not finish; finished work is one of its services.
  const sessions = plans.filter(
    (plan) => !here(plan.performedInVisitId) && plan.sessions.some(({ visitId }) => here(visitId)),
  ).length;
  return {
    ...NO_FLOW_FACTS,
    historyConfirmed: visit.historyConfirmation !== null,
    hasReason: (visit.reason ?? '').trim() !== '',
    hasComplaint: visit.painScore !== null || visit.painSince !== null,
    diagnoses: chart?.diagnoses.filter((record) => here(record.recordedInVisitId)).length ?? 0,
    presenceChanges:
      chart?.presence.filter((row) => here(row.visitId) && row.serviceId === null).length ?? 0,
    files,
    plans: plans.filter((plan) => here(plan.recordedInVisitId) && plan.status !== 'cancelled')
      .length,
    worklistTouched: visit.worklist.filter((item) => worked.has(item.planId)).length,
    work: visit.services.filter((service) => !service.autoAdded).length + sessions,
  };
}
