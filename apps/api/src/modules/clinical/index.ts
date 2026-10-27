// Public API of the clinical module. Other modules import from this file only (CLAUDE.md §4).
export { ClinicalModule } from './clinical.module';
export { CatalogService } from './application/catalog/catalog.service';
export { ChartService } from './application/reads/chart.service';
export { PatientRecordsService } from './application/records/patient-records.service';
export { type VisitSearchInternal, VisitListService } from './application/reads/visit-list.service';
export {
  type PlanWorkFacts,
  type VisitChargeFacts,
  VisitFactsService,
  type VisitMoneyFacts,
} from './application/visits/visit-facts.service';
export {
  type VisitImport,
  type VisitImportResult,
  VisitImportService,
} from './application/visits/visit-import.service';
export { VisitsService } from './application/visits/visits.service';
export type {
  CompensationVisitQuery,
  CompensationVisitRow,
  VisitRef,
} from './persistence/visits.repository';
export {
  CatalogItemInactiveError,
  CatalogItemInUseError,
  CatalogItemNotFoundError,
} from './domain/catalog-errors';
export { VisitNotLiveError } from './domain/visit-errors';
export { CATALOG_CHANGED, type CatalogChanged } from './events/catalog-changed';
export {
  DIAGNOSIS_EVIDENCE_CITED,
  type DiagnosisEvidenceCited,
  TREATMENT_ACCEPTED,
  TREATMENT_PRIORITISED,
  type TreatmentAccepted,
  type TreatmentPrioritised,
} from './events/record-events';
export { EvidenceInvalidError } from './domain/visit-errors';
export {
  DIAGNOSIS_RECORDED,
  DIAGNOSIS_REOPENED,
  DIAGNOSIS_RESOLVED,
  type DiagnosisRecorded,
  type DiagnosisReopened,
  type DiagnosisResolved,
  TOOTH_PRESENCE_CHANGED,
  type ToothPresenceChanged,
  TREATMENT_CANCELLED,
  TREATMENT_PERFORMED,
  TREATMENT_PLANNED,
  TREATMENT_REMOVED,
  TREATMENT_STARTED,
  type TreatmentCancelled,
  type TreatmentPerformed,
  type TreatmentPlanned,
  type TreatmentRemoved,
  type TreatmentStarted,
} from './events/record-events';
export { MEDICAL_HISTORY_CONFIRMED, type MedicalHistoryConfirmed } from './events/visit-events';
export {
  VISIT_AMENDED,
  VISIT_COMPLETED,
  VISIT_DISCARDED,
  VISIT_PAUSED,
  VISIT_RESUMED,
  VISIT_STARTED,
  VISIT_VOIDED,
  type VisitAmended,
  type VisitCompleted,
  type VisitDiscarded,
  type VisitPaused,
  type VisitResumed,
  type VisitStarted,
  type VisitVoided,
} from './events/visit-events';
