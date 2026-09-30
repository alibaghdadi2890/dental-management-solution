// Public API of the clinical module. Other modules import from this file only (CLAUDE.md §4).
export { ClinicalModule } from './clinical.module';
export { CatalogService } from './application/catalog.service';
export { ChartService } from './application/chart.service';
export { VisitRecordsService } from './application/visit-records.service';
export { VisitsService } from './application/visits.service';
export {
  CatalogItemInactiveError,
  CatalogItemInUseError,
  CatalogItemNotFoundError,
} from './domain/catalog-errors';
export { CATALOG_CHANGED, type CatalogChanged } from './events/catalog-changed';
export {
  DIAGNOSIS_RECORDED,
  DIAGNOSIS_REOPENED,
  DIAGNOSIS_RESOLVED,
  type DiagnosisRecorded,
  type DiagnosisReopened,
  type DiagnosisResolved,
  TOOTH_STATUS_CHANGED,
  type ToothStatusChanged,
  TREATMENT_CANCELLED,
  TREATMENT_PERFORMED,
  TREATMENT_PLANNED,
  type TreatmentCancelled,
  type TreatmentPerformed,
  type TreatmentPlanned,
} from './events/record-events';
export {
  VISIT_COMPLETED,
  VISIT_DISCARDED,
  VISIT_PAUSED,
  VISIT_RESUMED,
  VISIT_STARTED,
  type VisitCompleted,
  type VisitDiscarded,
  type VisitPaused,
  type VisitResumed,
  type VisitStarted,
} from './events/visit-events';
