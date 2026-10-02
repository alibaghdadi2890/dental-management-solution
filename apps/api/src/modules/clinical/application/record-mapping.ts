import {
  type DiagnosisRecord,
  type HistoryService,
  lineFinal,
  surfacesSchema,
  toothCodeSchema,
  type TreatmentPlan,
} from '@dcm/contracts';
import type { StoredDiagnosisRecord } from '../persistence/patient-diagnoses.repository';
import type { StoredTreatmentPlan } from '../persistence/treatment-plans.repository';
import type { FinishedService } from '../persistence/visit-services.repository';

// The tables' CHECKs admit exactly the contract's tooth codes and surface keys.

/** A diagnosis record as the API answers it: the row plus who and when, for display. */
export function toDiagnosisRecord(
  record: StoredDiagnosisRecord,
  recordedInVisitDate: string,
  dentistName: string,
): DiagnosisRecord {
  return {
    id: record.id,
    patientId: record.patientId,
    toothCode: toothCodeSchema.parse(record.toothCode),
    surfaces: surfacesSchema.parse(record.surfaces),
    diagnosisId: record.diagnosisId,
    code: record.code,
    name: record.name,
    category: record.category,
    status: record.status,
    note: record.note,
    dentistId: record.dentistId,
    dentistName,
    recordedBy: record.recordedBy,
    recordedInVisitId: record.recordedInVisitId,
    recordedInVisitDate,
    recordedAt: record.recordedAt.toISOString(),
    resolvedInVisitId: record.resolvedInVisitId,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
  };
}

/** A treatment plan as the API answers it: the row plus the dentist's name. */
export function toTreatmentPlan(plan: StoredTreatmentPlan, dentistName: string): TreatmentPlan {
  return {
    id: plan.id,
    patientId: plan.patientId,
    toothCode: plan.toothCode === null ? null : toothCodeSchema.parse(plan.toothCode),
    surfaces: surfacesSchema.parse(plan.surfaces),
    procedureId: plan.procedureId,
    code: plan.code,
    name: plan.name,
    category: plan.category,
    chargeUnit: plan.chargeUnit,
    price: { amount: plan.priceAmount, currency: plan.priceCurrency },
    diagnosisRecordId: plan.diagnosisRecordId,
    status: plan.status,
    note: plan.note,
    dentistId: plan.dentistId,
    dentistName,
    recordedBy: plan.recordedBy,
    recordedInVisitId: plan.recordedInVisitId,
    recordedAt: plan.recordedAt.toISOString(),
    performedInVisitId: plan.performedInVisitId,
    performedAt: plan.performedAt?.toISOString() ?? null,
    cancelledInVisitId: plan.cancelledInVisitId,
    cancelledAt: plan.cancelledAt?.toISOString() ?? null,
  };
}

/** A service of a completed visit as a history line: its final price in the visit currency. */
export function toHistoryService(
  { service, visitDate, currency }: FinishedService,
  dentistName: string,
): HistoryService {
  return {
    id: service.id,
    visitId: service.visitId,
    visitDate,
    dentistName,
    code: service.code,
    name: service.name,
    toothCode: service.toothCode === null ? null : toothCodeSchema.parse(service.toothCode),
    surfaces: surfacesSchema.parse(service.surfaces),
    final: {
      amount: lineFinal({ base: service.baseAmount, discount: service.discountAmount }),
      currency,
    },
    planId: service.planId,
  };
}
