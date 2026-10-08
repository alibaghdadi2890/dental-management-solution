// Public API of the clinical module. Other modules import from this file only (CLAUDE.md §4).
export { ClinicalModule } from './clinical.module';
export { CatalogService } from './application/catalog.service';
export { ChartService } from './application/chart.service';
export { PatientRecordsService } from './application/patient-records.service';
export { VisitRecordsService } from './application/visit-records.service';
export {
  type VisitChargeFacts,
  type VisitMoneyFacts,
  type VisitSearchInternal,
  VisitsService,
} from './application/visits.service';
export type { VisitRef } from './persistence/visits.repository';
export {
  CatalogItemInactiveError,
  CatalogItemInUseError,
  CatalogItemNotFoundError,
} from './domain/catalog-errors';
export { VisitNotLiveError } from './domain/visit-errors';
export { CATALOG_CHANGED, type CatalogChanged } from './events/catalog-changed';
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
  TREATMENT_STARTED,
  type TreatmentCancelled,
  type TreatmentPerformed,
  type TreatmentPlanned,
  type TreatmentStarted,
} from './events/record-events';
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
