import type { ExpenseCategory } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';

/**
 * A category's name in the UI language: a keyed one is translated, a custom one is as typed.
 * As a hook, so every screen names categories the same way.
 */
export function useCategoryName(): (
  category: Pick<ExpenseCategory, 'key' | 'name'> | undefined,
) => string {
  const { t } = useTranslation('expenses');
  return (category) => {
    if (!category) return '—';
    return category.key === null ? (category.name ?? '') : t(`category.${category.key}`);
  };
}

/** The categories a new expense may use: active and not reserved, in the clinic's list order. */
export const selectableCategories = (categories: readonly ExpenseCategory[]) =>
  categories.filter((category) => category.active && category.kind !== 'reserved');

/** Why an expense form can't be saved yet (`expenses:panel.problems.*`). */
export type ExpenseProblem = 'required' | 'amount' | 'description' | 'future';
