// Public API of the clinical module. Other modules import from this file only (CLAUDE.md §4).
export { ClinicalModule } from './clinical.module';
export { CatalogService } from './application/catalog.service';
export { VisitsService } from './application/visits.service';
export { CatalogItemInUseError, CatalogItemNotFoundError } from './domain/catalog-errors';
export { CATALOG_CHANGED, type CatalogChanged } from './events/catalog-changed';
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
