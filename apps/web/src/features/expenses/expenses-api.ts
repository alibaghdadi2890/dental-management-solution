import {
  type ConfirmItemsRequest,
  type CreateExpenseCategory,
  type CreateFixedExpenseRequest,
  expenseCategorySchema,
  expenseDashboardSchema,
  type ExpenseListQuery,
  expensePageSchema,
  type ExpenseReason,
  expenseSchema,
  expenseYearSchema,
  type ExportLanguage,
  fixedExpenseDetailSchema,
  fixedExpenseSchema,
  fixedItemSchema,
  type RecordExpenseRequest,
  type SkipItem,
  type UpdateExpenseCategory,
  type UpdateExpenseRequest,
  type UpdateFixedExpenseRequest,
} from '@dcm/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { IDEMPOTENCY_HEADER } from '@/lib/idempotency';

/** The History filter as the API takes it (paging aside). */
export type ExpenseFilter = Omit<ExpenseListQuery, 'cursor' | 'limit'>;

/**
 * What the clinic spends (feature 17, `expenses` module): categories, the history and its
 * totals, the year, fixed expenses and the months waiting for confirmation, and Today's card.
 * Keys are scoped under the acting tenant like the other features'.
 */
export const expenseKeys = {
  all: (tenantId: string | null) => ['expenses', tenantId] as const,
  categories: (tenantId: string | null) => [...expenseKeys.all(tenantId), 'categories'] as const,
  list: (tenantId: string | null, filter: ExpenseFilter) =>
    [...expenseKeys.all(tenantId), 'list', filter] as const,
  year: (tenantId: string | null, year: number) =>
    [...expenseKeys.all(tenantId), 'year', year] as const,
  dashboard: (tenantId: string | null) => [...expenseKeys.all(tenantId), 'dashboard'] as const,
  pending: (tenantId: string | null) => [...expenseKeys.all(tenantId), 'pending'] as const,
  fixed: (tenantId: string | null) => [...expenseKeys.all(tenantId), 'fixed'] as const,
  fixedOne: (tenantId: string | null, id: string) =>
    [...expenseKeys.all(tenantId), 'fixed', id] as const,
};

function filterQuery(filter: ExpenseFilter & { lang?: ExportLanguage }): string {
  const params = new URLSearchParams({ from: filter.from, to: filter.to });
  if (filter.categoryId) params.set('categoryId', filter.categoryId);
  if (filter.branchId) params.set('branchId', filter.branchId);
  if (filter.method) params.set('method', filter.method);
  if (filter.q) params.set('q', filter.q);
  if (filter.includeVoided) params.set('includeVoided', 'true');
  if (filter.lang) params.set('lang', filter.lang);
  return params.toString();
}

export function categoriesQuery() {
  return queryOptions({
    queryKey: expenseKeys.categories(actingTenantId()),
    queryFn: () => apiFetch('/expenses/categories', z.array(expenseCategorySchema)),
    staleTime: 60_000,
  });
}

/** The History: up to 200 rows of the filter, and its totals over all of it. */
export function expensesQuery(filter: ExpenseFilter) {
  return queryOptions({
    queryKey: expenseKeys.list(actingTenantId(), filter),
    queryFn: () => apiFetch(`/expenses?${filterQuery(filter)}&limit=200`, expensePageSchema),
  });
}

export function expenseYearQuery(year: number) {
  return queryOptions({
    queryKey: expenseKeys.year(actingTenantId(), year),
    queryFn: () => apiFetch(`/expenses/year?year=${String(year)}`, expenseYearSchema),
  });
}

export function expenseDashboardQuery(enabled = true) {
  return queryOptions({
    queryKey: expenseKeys.dashboard(actingTenantId()),
    queryFn: () => apiFetch('/expenses/dashboard', expenseDashboardSchema),
    enabled,
  });
}

export function pendingItemsQuery() {
  return queryOptions({
    queryKey: expenseKeys.pending(actingTenantId()),
    queryFn: () => apiFetch('/expenses/pending', z.array(fixedItemSchema)),
  });
}

export function fixedExpensesQuery() {
  return queryOptions({
    queryKey: expenseKeys.fixed(actingTenantId()),
    queryFn: () => apiFetch('/expenses/fixed', z.array(fixedExpenseSchema)),
  });
}

export function fixedExpenseQuery(id: string) {
  return queryOptions({
    queryKey: expenseKeys.fixedOne(actingTenantId(), id),
    queryFn: () => apiFetch(`/expenses/fixed/${id}`, fixedExpenseDetailSchema),
  });
}

/** Every expenses read of the acting clinic, after any write. */
export function invalidateExpenses(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: expenseKeys.all(actingTenantId()) });
}

export function recordExpense(input: RecordExpenseRequest, idempotencyKey: string) {
  return apiFetch('/expenses', expenseSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
  });
}

export function updateExpense(id: string, input: UpdateExpenseRequest) {
  return apiFetch(`/expenses/${id}`, expenseSchema, { method: 'PATCH', json: input });
}

export function voidExpense(id: string, input: ExpenseReason) {
  return apiFetch(`/expenses/${id}/void`, expenseSchema, { method: 'POST', json: input });
}

export function confirmItems(input: ConfirmItemsRequest, idempotencyKey: string) {
  return apiFetch('/expenses/pending/confirm', z.array(expenseSchema), {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
  });
}

export function skipItem(id: string, input: SkipItem) {
  return apiFetch(`/expenses/pending/${id}/skip`, fixedItemSchema, { method: 'POST', json: input });
}

export function unskipItem(id: string) {
  return apiFetch(`/expenses/pending/${id}/unskip`, fixedItemSchema, { method: 'POST' });
}

export function createFixedExpense(input: CreateFixedExpenseRequest) {
  return apiFetch('/expenses/fixed', fixedExpenseDetailSchema, { method: 'POST', json: input });
}

export function updateFixedExpense(id: string, input: UpdateFixedExpenseRequest) {
  return apiFetch(`/expenses/fixed/${id}`, fixedExpenseDetailSchema, {
    method: 'PATCH',
    json: input,
  });
}

export function changeFixedExpense(id: string, change: 'pause' | 'resume' | 'end') {
  return apiFetch(`/expenses/fixed/${id}/${change}`, fixedExpenseDetailSchema, { method: 'POST' });
}

export function createCategory(input: CreateExpenseCategory) {
  return apiFetch('/expenses/categories', expenseCategorySchema, { method: 'POST', json: input });
}

export function updateCategory(id: string, input: UpdateExpenseCategory) {
  return apiFetch(`/expenses/categories/${id}`, expenseCategorySchema, {
    method: 'PATCH',
    json: input,
  });
}

export function deleteCategory(id: string) {
  return apiFetch(`/expenses/categories/${id}`, z.undefined(), { method: 'DELETE' });
}

export function downloadExpenses(
  filter: ExpenseFilter,
  lang: ExportLanguage | undefined,
): Promise<void> {
  return downloadCsv(
    `/expenses/export?${filterQuery({ ...filter, ...(lang ? { lang } : {}) })}`,
    `expenses-${filter.from}-${filter.to}.csv`,
  );
}
