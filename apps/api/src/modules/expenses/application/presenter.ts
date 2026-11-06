import {
  categoryKindOf,
  type Expense,
  type ExpenseCategory,
  type FixedExpense,
  type FixedItem,
} from '@dcm/contracts';
import type { StoredCategory } from '../persistence/categories.repository';
import type { StoredExpense } from '../persistence/expenses.repository';
import type { StoredFixedExpense, StoredItem } from '../persistence/fixed-expenses.repository';

export function toCategory(row: StoredCategory, inUse: boolean): ExpenseCategory {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    kind: categoryKindOf(row.key),
    active: row.active,
    inUse,
  };
}

/** What an audit row says about a category: its key (translated by the SPA) or its name. */
export const categoryLabel = (row: StoredCategory) => ({
  categoryKey: row.key,
  categoryName: row.name,
});

export function toExpense(row: StoredExpense): Expense {
  return {
    id: row.id,
    spentOn: row.spentOn,
    categoryId: row.categoryId,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    payee: row.payee,
    reference: row.reference,
    description: row.description,
    branchId: row.branchId,
    source: row.source,
    sourceId: row.sourceId,
    sourceMonth: row.sourceMonth,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

export function toFixedExpense(row: StoredFixedExpense, pendingCount: number): FixedExpense {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    payee: row.payee,
    branchId: row.branchId,
    note: row.note,
    firstMonth: row.firstMonth,
    nextMonth: row.nextMonth,
    status: row.status,
    pendingCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toItem(row: StoredItem): FixedItem {
  return {
    id: row.id,
    fixedExpenseId: row.fixedExpenseId,
    month: row.month,
    name: row.name,
    categoryId: row.categoryId,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    payee: row.payee,
    branchId: row.branchId,
    status: row.status,
    expenseId: row.expenseId,
    skipReason: row.skipReason,
  };
}
