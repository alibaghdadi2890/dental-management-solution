import type { CatalogKind } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

export const CATALOG_CHANGED = 'CatalogChanged';

/** Rows of one catalog were created, changed, deactivated or deleted (C7). */
export type CatalogChanged = DomainEvent<
  typeof CATALOG_CHANGED,
  { kind: CatalogKind; ids: string[] }
>;
