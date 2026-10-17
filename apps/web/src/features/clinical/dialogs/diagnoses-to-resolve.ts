import type { DiagnosisRecord, PatientChart, Visit, VisitService } from '@dcm/contracts';

/** An active diagnosis this visit's work may have fixed, with the services that touched it. */
export interface DiagnosisToResolve {
  record: DiagnosisRecord;
  services: VisitService[];
}

/**
 * The active diagnoses the dentist may have forgotten to resolve before Complete visit: on a tooth
 * one of this visit's services touches, or treated by a plan this visit performed (its
 * `diagnosisRecordId`). Those recorded today count too. Work only started today adds no service,
 * and diagnoses are per tooth, so a jaw or mouth service lists nothing. Each diagnosis once, in
 * FDI order, then as recorded.
 */
export function diagnosesToResolve(visit: Visit, chart: PatientChart): DiagnosisToResolve[] {
  const performedPlans = new Set(visit.services.flatMap((service) => service.planId ?? []));
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
      services: visit.services.filter(
        (service) =>
          service.toothCode === record.toothCode ||
          (service.planId !== null && treatedBy.get(record.id)?.has(service.planId) === true),
      ),
    }))
    .filter((candidate) => candidate.services.length > 0)
    .sort(
      (a, b) =>
        Number(a.record.toothCode) - Number(b.record.toothCode) ||
        a.record.recordedAt.localeCompare(b.record.recordedAt),
    );
}
