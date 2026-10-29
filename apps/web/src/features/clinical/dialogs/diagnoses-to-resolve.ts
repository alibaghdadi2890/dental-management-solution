import type { DiagnosisRecord, PatientChart, Visit } from '@dcm/contracts';

/** Something this visit did: one of its services, or work it completed that an earlier visit
 * charged (ADR-0064). */
export interface WorkDone {
  id: string;
  name: string;
}

/** An active diagnosis this visit's work may have fixed, with the work that touched it. */
export interface DiagnosisToResolve {
  record: DiagnosisRecord;
  done: WorkDone[];
}

/** Teeth in FDI order first, then the jaws and the whole mouth. */
const placeOrder = (record: DiagnosisRecord) =>
  record.toothCode !== null
    ? Number(record.toothCode)
    : record.jaw === 'upper'
      ? 100
      : record.jaw === 'lower'
        ? 101
        : 102;

/**
 * The active diagnoses the dentist may have forgotten to resolve before Complete visit: on a tooth
 * this visit's work touches, or treated by a plan this visit performed (its `diagnosisRecordId`).
 * This visit's work is its services, less those that charge work still in progress, plus the work
 * it completed whose charge is an earlier visit's line (ADR-0064). Those recorded today count too.
 * A diagnosis on a jaw or the whole mouth is listed only through a plan for it: every visit has
 * some whole-mouth service (the examination). Each diagnosis once, teeth in FDI order then the
 * jaws and the mouth, then as recorded.
 */
export function diagnosesToResolve(visit: Visit, chart: PatientChart): DiagnosisToResolve[] {
  const unfinished = new Set(
    chart.plans.filter((plan) => plan.status === 'in_progress').map((plan) => plan.id),
  );
  const lines = visit.services.filter(
    (service) => service.planId === null || !unfinished.has(service.planId),
  );
  const withLine = new Set(lines.flatMap((service) => service.planId ?? []));
  const completedHere = chart.plans.filter(
    (plan) =>
      plan.status === 'performed' && plan.performedInVisitId === visit.id && !withLine.has(plan.id),
  );
  const work = [
    ...lines.map(({ id, name, toothCode, planId }) => ({ id, name, toothCode, planId })),
    ...completedHere.map(({ id, name, toothCode }) => ({ id, name, toothCode, planId: id })),
  ];
  const performedPlans = new Set(work.flatMap((item) => item.planId ?? []));
  /** Per diagnosis, the plans for it that this visit performed. */
  const treatedBy = new Map<string, Set<string>>();
  for (const plan of chart.plans) {
    if (plan.diagnosisRecordId === null || !performedPlans.has(plan.id)) continue;
    const plans = treatedBy.get(plan.diagnosisRecordId) ?? new Set<string>();
    plans.add(plan.id);
    treatedBy.set(plan.diagnosisRecordId, plans);
  }
  return chart.diagnoses
    .filter((record) => record.status === 'active')
    .map((record) => ({
      record,
      done: work
        .filter(
          (item) =>
            (record.toothCode !== null && item.toothCode === record.toothCode) ||
            (item.planId !== null && treatedBy.get(record.id)?.has(item.planId) === true),
        )
        .map(({ id, name }) => ({ id, name })),
    }))
    .filter((candidate) => candidate.done.length > 0)
    .sort(
      (a, b) =>
        placeOrder(a.record) - placeOrder(b.record) ||
        a.record.recordedAt.localeCompare(b.record.recordedAt),
    );
}
