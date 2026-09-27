import { DomainError } from '../../../platform/kernel/domain-error';

export class CatalogItemNotFoundError extends DomainError {
  readonly code = 'catalog.not_found';
  readonly kind = 'not_found';
}

/** A row visits refer to is deactivated, never deleted (C5): it stays on past visits. */
export class CatalogItemInUseError extends DomainError {
  readonly code = 'catalog.in_use';
  readonly kind = 'conflict';
}
