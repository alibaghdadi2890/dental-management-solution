import type { ExpenseCategoryKind } from '@dcm/contracts';
import {
  CategoryInactiveError,
  CategoryInUseError,
  CategoryLockedError,
  CategoryNameTakenError,
  CategoryReservedError,
  DescriptionRequiredError,
} from './expense-errors';

export type CategoryChange = 'rename' | 'deactivate' | 'reactivate' | 'delete';

/**
 * What each kind of category allows (D7):
 * - a predefined one can be deactivated and reactivated, but never renamed or deleted;
 * - *Other* and the reserved ones never change;
 * - a custom one can do all of these, and is deleted only while nothing uses it.
 */
export function assertCategoryChange(
  kind: ExpenseCategoryKind,
  change: CategoryChange,
  inUse: boolean,
): void {
  const allowed =
    kind === 'custom' ||
    (kind === 'predefined' && (change === 'deactivate' || change === 'reactivate'));
  if (!allowed) throw new CategoryLockedError(`A ${kind} category can't be changed that way`);
  if (change === 'delete' && inUse) {
    throw new CategoryInUseError('This category is used; deactivate it instead');
  }
}

/** A category offered for a new expense, fixed expense or confirmation. */
export function assertSelectable(category: { kind: ExpenseCategoryKind; active: boolean }): void {
  if (category.kind === 'reserved') {
    throw new CategoryReservedError('This category is written by the system only');
  }
  if (!category.active) throw new CategoryInactiveError('This category is deactivated');
}

/** An expense in *Other* must say what it was. */
export function assertDescribed(kind: ExpenseCategoryKind, description: string | null): void {
  if (kind === 'other' && description === null) {
    throw new DescriptionRequiredError('Say what this expense was');
  }
}

const folded = (name: string) => name.trim().toLocaleLowerCase();

/**
 * A custom name must be unique in the clinic, case-insensitively. It is checked against the other
 * custom names and every translation of the keyed categories (`taken`).
 */
export function assertNameFree(name: string, taken: Iterable<string>): void {
  const wanted = folded(name);
  for (const existing of taken) {
    if (folded(existing) === wanted) {
      throw new CategoryNameTakenError('Another category has this name');
    }
  }
}
