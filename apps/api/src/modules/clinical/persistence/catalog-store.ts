import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';

/** What `CatalogService` needs from each catalog's repository; both catalogs behave alike. */
export interface CatalogStore<
  TItem extends { id: string; code: string; name: string; active: boolean },
> {
  /** Live (not deleted) rows, oldest first: seeded rows keep the template order. */
  list(): Promise<TItem[]>;
  /** A live row. */
  byId(id: string): Promise<TItem | undefined>;
  /** Inserts or updates by id inside the caller's transaction; a batch may swap codes. */
  save(items: readonly TItem[], existingIds: ReadonlySet<string>): Promise<void>;
  /** Inserts the rows whose code is free; returns those inserted. */
  insertIfAbsent(items: readonly TItem[]): Promise<TItem[]>;
  softDelete(id: string): Promise<void>;
  deactivate(id: string): Promise<TItem>;
  countLive(): Promise<number>;
}

/** Placeholder a row's code moves to while a batch rewrites codes (indexes check per statement). */
export const swappingCode = (id: string) => `~swapping~${id}`;

/**
 * A concurrent save took a code between our check and our write: the same answer the domain rule
 * gives, without a row index.
 */
export function rethrowCodeRace(error: unknown, constraint: string): never {
  if (isUniqueViolation(error, constraint)) {
    throw new ValidationFailedError('A code in this batch is already used', [
      { path: 'items', code: 'duplicate', message: 'A code in this batch is already used' },
    ]);
  }
  throw error;
}
