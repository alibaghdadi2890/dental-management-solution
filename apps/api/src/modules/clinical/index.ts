// Public API of the clinical module. Other modules import from this file only (CLAUDE.md §4).
export { ClinicalModule } from './clinical.module';
export { CatalogService } from './application/catalog.service';
export { CatalogItemInUseError, CatalogItemNotFoundError } from './domain/catalog-errors';
export { CATALOG_CHANGED, type CatalogChanged } from './events/catalog-changed';
