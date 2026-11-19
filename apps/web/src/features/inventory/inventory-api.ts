import {
  type AdjustStockRequest,
  countListSchema,
  countSchema,
  type CreateSupplierRequest,
  type EditReceiptRequest,
  type ExportLanguage,
  inventoryCategorySchema,
  inventoryItemSchema,
  type InventoryReportQuery,
  inventoryReportSchema,
  inventorySettingsSchema,
  itemDetailSchema,
  type MarkOrdered,
  type MarkOrderedMany,
  movementPageSchema,
  movementSchema,
  type MovementKind,
  type MovementReason,
  type PriceBatch,
  type PriceReceiptRequest,
  type ReceiptListQuery,
  receiptFileUrlSchema,
  receiptPageSchema,
  type ReceiptUploadIntent,
  receiptUploadTargetsSchema,
  type ReceiveRequest,
  type RecordSupplierAdjustment,
  type RecordSupplierPaymentRequest,
  reorderListSchema,
  type SaveCountLineRequest,
  type SaveItemsRequest,
  type StartCountRequest,
  stockListSchema,
  stockReceiptSchema,
  stockTodaySchema,
  supplierAccountsSchema,
  supplierAdjustmentSchema,
  type SupplierOpeningBalance,
  supplierPaymentSchema,
  supplierSchema,
  supplierStatementSchema,
  takeOutResultSchema,
  type TakeOutRequest,
  type UpdateSupplierRequest,
} from '@dcm/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { IDEMPOTENCY_HEADER } from '@/lib/idempotency';

/** What the movements list is asked for (paging aside): an item's history, a figure's rows. */
export interface MovementFilter {
  itemId?: string | undefined;
  branchId?: string | undefined;
  categoryId?: string | undefined;
  supplierId?: string | undefined;
  kinds?: readonly MovementKind[] | undefined;
  reason?: MovementReason | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export type ReceiptFilter = Omit<ReceiptListQuery, 'cursor' | 'limit'>;

/**
 * The inventory API (feature 20a, `inventory` module). Keys are scoped under the acting tenant;
 * every write invalidates the whole `inventory` tree (stock feeds the labels, Today and reports).
 */
export const inventoryKeys = {
  all: (tenantId: string | null) => ['inventory', tenantId] as const,
  part: (tenantId: string | null, ...rest: readonly unknown[]) =>
    [...inventoryKeys.all(tenantId), ...rest] as const,
};

const key = (...rest: readonly unknown[]) => inventoryKeys.part(actingTenantId(), ...rest);

type QueryValue = string | number | boolean | readonly string[] | null | undefined;

function queryString(values: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(name, typeof value === 'object' ? value.join(',') : String(value));
  }
  return params.toString();
}

const idempotent = (idempotencyKey: string) => ({ [IDEMPOTENCY_HEADER]: idempotencyKey });

// --- Reads ---

export const categoriesQuery = () =>
  queryOptions({
    queryKey: key('categories'),
    queryFn: () => apiFetch('/inventory/categories', z.array(inventoryCategorySchema)),
    staleTime: 60_000,
  });

export const itemsQuery = () =>
  queryOptions({
    queryKey: key('items'),
    queryFn: () => apiFetch('/inventory/items', z.array(inventoryItemSchema)),
  });

export const itemQuery = (itemId: string) =>
  queryOptions({
    queryKey: key('item', itemId),
    queryFn: () => apiFetch(`/inventory/items/${itemId}`, itemDetailSchema),
  });

export const stockQuery = (branchId: string) =>
  queryOptions({
    queryKey: key('stock', branchId),
    queryFn: () => apiFetch(`/inventory/stock?branchId=${branchId}`, stockListSchema),
  });

export const stockTodayQuery = (branchId: string, enabled = true) =>
  queryOptions({
    queryKey: key('today', branchId),
    queryFn: () => apiFetch(`/inventory/today?branchId=${branchId}`, stockTodaySchema),
    enabled,
  });

export const reorderQuery = (branchId: string) =>
  queryOptions({
    queryKey: key('reorder', branchId),
    queryFn: () => apiFetch(`/inventory/reorder?branchId=${branchId}`, reorderListSchema),
  });

export const movementsQuery = (filter: MovementFilter, enabled = true) =>
  queryOptions({
    queryKey: key('movements', filter),
    queryFn: () =>
      apiFetch(
        `/inventory/movements?${queryString({ ...filter, limit: 100 })}`,
        movementPageSchema,
      ),
    enabled,
  });

export const settingsQuery = () =>
  queryOptions({
    queryKey: key('settings'),
    queryFn: () => apiFetch('/inventory/settings', inventorySettingsSchema),
  });

export const receiptsQuery = (filter: ReceiptFilter) =>
  queryOptions({
    queryKey: key('receipts', filter),
    queryFn: () =>
      apiFetch(`/inventory/receipts?${queryString({ ...filter, limit: 100 })}`, receiptPageSchema),
  });

export const receiptQuery = (receiptId: string) =>
  queryOptions({
    queryKey: key('receipt', receiptId),
    queryFn: () => apiFetch(`/inventory/receipts/${receiptId}`, stockReceiptSchema),
  });

export const countsQuery = (branchId: string) =>
  queryOptions({
    queryKey: key('counts', branchId),
    queryFn: () => apiFetch(`/inventory/counts?branchId=${branchId}`, countListSchema),
  });

export const countQuery = (countId: string) =>
  queryOptions({
    queryKey: key('count', countId),
    queryFn: () => apiFetch(`/inventory/counts/${countId}`, countSchema),
  });

export const suppliersQuery = (includeInactive = false) =>
  queryOptions({
    queryKey: key('suppliers', includeInactive),
    queryFn: () =>
      apiFetch(
        `/inventory/suppliers${includeInactive ? '?includeInactive=true' : ''}`,
        z.array(supplierSchema),
      ),
    staleTime: 60_000,
  });

export const supplierQuery = (supplierId: string) =>
  queryOptions({
    queryKey: key('supplier', supplierId),
    queryFn: () => apiFetch(`/inventory/suppliers/${supplierId}`, supplierSchema),
  });

export const accountsQuery = (enabled = true) =>
  queryOptions({
    queryKey: key('accounts'),
    queryFn: () => apiFetch('/inventory/suppliers/accounts', supplierAccountsSchema),
    enabled,
  });

export const statementQuery = (supplierId: string, from: string, to: string, enabled = true) =>
  queryOptions({
    queryKey: key('statement', supplierId, from, to),
    queryFn: () =>
      apiFetch(
        `/inventory/suppliers/${supplierId}/statement?from=${from}&to=${to}`,
        supplierStatementSchema,
      ),
    enabled,
  });

export const reportQuery = (query: InventoryReportQuery) =>
  queryOptions({
    queryKey: key('report', query),
    queryFn: () => apiFetch(`/inventory/reports?${queryString(query)}`, inventoryReportSchema),
  });

/** Every inventory read of the acting clinic, and Expenses (a payment writes a row there). */
export async function invalidateInventory(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: inventoryKeys.all(actingTenantId()) }),
    queryClient.invalidateQueries({ queryKey: ['expenses'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboards'] }),
  ]);
}

// --- Items and categories ---

export const saveItems = (input: SaveItemsRequest) =>
  apiFetch('/inventory/items', z.array(inventoryItemSchema), { method: 'PUT', json: input });

export const createCategory = (name: string) =>
  apiFetch('/inventory/categories', inventoryCategorySchema, { method: 'POST', json: { name } });

export const updateCategory = (id: string, patch: { name?: string; active?: boolean }) =>
  apiFetch(`/inventory/categories/${id}`, inventoryCategorySchema, {
    method: 'PATCH',
    json: patch,
  });

export const deleteCategory = (id: string) =>
  apiFetch(`/inventory/categories/${id}`, z.undefined(), { method: 'DELETE' });

export const setBranchLevel = (itemId: string, branchId: string, reorderLevel: number | null) =>
  apiFetch(`/inventory/items/${itemId}/branches/${branchId}`, z.undefined(), {
    method: 'PUT',
    json: { reorderLevel },
  });

export const markOrdered = (itemId: string, branchId: string, input: MarkOrdered) =>
  apiFetch(`/inventory/items/${itemId}/branches/${branchId}/ordered`, z.undefined(), {
    method: 'PUT',
    json: input,
  });

export const unmarkOrdered = (itemId: string, branchId: string) =>
  apiFetch(`/inventory/items/${itemId}/branches/${branchId}/ordered`, z.undefined(), {
    method: 'DELETE',
  });

export const markOrderedMany = (input: MarkOrderedMany) =>
  apiFetch('/inventory/reorder/ordered', z.undefined(), { method: 'POST', json: input });

export const reportCount = (itemId: string, branchId: string) =>
  apiFetch(`/inventory/items/${itemId}/report-count`, z.undefined(), {
    method: 'POST',
    json: { branchId },
  });

export const updateSettings = (expiringDays: number) =>
  apiFetch('/inventory/settings', inventorySettingsSchema, {
    method: 'PUT',
    json: { expiringDays },
  });

// --- Stock ---

export const takeOut = (input: TakeOutRequest, idempotencyKey: string) =>
  apiFetch('/inventory/take-outs', takeOutResultSchema, {
    method: 'POST',
    json: input,
    headers: idempotent(idempotencyKey),
  });

export const undoMovement = (id: string) =>
  apiFetch(`/inventory/movements/${id}/undo`, movementSchema, { method: 'POST', json: {} });

export const reverseMovement = (id: string, reason: string) =>
  apiFetch(`/inventory/movements/${id}/reverse`, movementSchema, {
    method: 'POST',
    json: { reason },
  });

export const adjustStock = (input: AdjustStockRequest, idempotencyKey: string) =>
  apiFetch('/inventory/adjustments', movementSchema, {
    method: 'POST',
    json: input,
    headers: idempotent(idempotencyKey),
  });

export const priceBatch = (batchId: string, input: PriceBatch) =>
  apiFetch(`/inventory/batches/${batchId}/price`, z.undefined(), { method: 'PUT', json: input });

export const downloadStock = (branchId: string, lang?: ExportLanguage) =>
  downloadCsv(`/inventory/stock/export?${queryString({ branchId, lang })}`, 'stock.csv');

// --- Receipts ---

export const receive = (input: ReceiveRequest, idempotencyKey: string) =>
  apiFetch('/inventory/receipts', stockReceiptSchema, {
    method: 'POST',
    json: input,
    headers: idempotent(idempotencyKey),
  });

export const priceReceipt = (id: string, input: PriceReceiptRequest) =>
  apiFetch(`/inventory/receipts/${id}/prices`, stockReceiptSchema, { method: 'PUT', json: input });

export const editReceipt = (id: string, input: EditReceiptRequest) =>
  apiFetch(`/inventory/receipts/${id}`, stockReceiptSchema, { method: 'PATCH', json: input });

export const voidReceipt = (id: string, reason: string) =>
  apiFetch(`/inventory/receipts/${id}/void`, stockReceiptSchema, {
    method: 'POST',
    json: { reason },
  });

/** Asks where to upload, sends the bytes straight to storage, then seals them on the receipt. */
export async function attachFiles(receiptId: string, files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  const intent: ReceiptUploadIntent = {
    files: files.map((file) => ({
      filename: file.name,
      mimeType: file.type as ReceiptUploadIntent['files'][number]['mimeType'],
      sizeBytes: file.size,
    })),
  };
  const { uploads } = await apiFetch(
    `/inventory/receipts/${receiptId}/files/uploads`,
    receiptUploadTargetsSchema,
    { method: 'POST', json: intent },
  );
  await Promise.all(
    uploads.map(async (upload, index) => {
      const response = await fetch(upload.url, {
        method: 'PUT',
        body: files[index] ?? null,
        headers: { 'Content-Type': upload.mimeType },
      });
      if (!response.ok) throw new Error(`Upload failed: ${String(response.status)}`);
    }),
  );
  await apiFetch(`/inventory/receipts/${receiptId}/files`, stockReceiptSchema, {
    method: 'POST',
    json: { ids: uploads.map((upload) => upload.id) },
  });
}

export const receiptFileUrl = (receiptId: string, fileId: string) =>
  apiFetch(`/inventory/receipts/${receiptId}/files/${fileId}`, receiptFileUrlSchema);

export const removeReceiptFile = (receiptId: string, fileId: string) =>
  apiFetch(`/inventory/receipts/${receiptId}/files/${fileId}`, stockReceiptSchema, {
    method: 'DELETE',
  });

// --- Counts ---

export const startCount = (input: StartCountRequest) =>
  apiFetch('/inventory/counts', countSchema, { method: 'POST', json: input });

export const saveCountLine = (countId: string, itemId: string, input: SaveCountLineRequest) =>
  apiFetch(`/inventory/counts/${countId}/lines/${itemId}`, countSchema, {
    method: 'PUT',
    json: input,
  });

export const applyCount = (countId: string, idempotencyKey: string) =>
  apiFetch(`/inventory/counts/${countId}/apply`, countSchema, {
    method: 'POST',
    headers: idempotent(idempotencyKey),
  });

export const discardCount = (countId: string) =>
  apiFetch(`/inventory/counts/${countId}/discard`, countSchema, { method: 'POST' });

// --- Suppliers ---

export const createSupplier = (input: CreateSupplierRequest) =>
  apiFetch('/inventory/suppliers', supplierSchema, { method: 'POST', json: input });

export const updateSupplier = (id: string, input: UpdateSupplierRequest) =>
  apiFetch(`/inventory/suppliers/${id}`, supplierSchema, { method: 'PATCH', json: input });

export const setSupplierOpeningBalance = (id: string, input: SupplierOpeningBalance) =>
  apiFetch(`/inventory/suppliers/${id}/opening-balance`, supplierSchema, {
    method: 'PUT',
    json: input,
  });

export const recordSupplierPayment = (
  id: string,
  input: RecordSupplierPaymentRequest,
  idempotencyKey: string,
) =>
  apiFetch(`/inventory/suppliers/${id}/payments`, supplierPaymentSchema, {
    method: 'POST',
    json: input,
    headers: idempotent(idempotencyKey),
  });

export const voidSupplierPayment = (id: string, reason: string) =>
  apiFetch(`/inventory/payments/${id}/void`, supplierPaymentSchema, {
    method: 'POST',
    json: { reason },
  });

export const recordSupplierAdjustment = (
  id: string,
  input: RecordSupplierAdjustment,
  idempotencyKey: string,
) =>
  apiFetch(`/inventory/suppliers/${id}/adjustments`, supplierAdjustmentSchema, {
    method: 'POST',
    json: input,
    headers: idempotent(idempotencyKey),
  });

export const downloadStatement = (
  supplierId: string,
  from: string,
  to: string,
  lang?: ExportLanguage,
) =>
  downloadCsv(
    `/inventory/suppliers/${supplierId}/statement/export?${queryString({ from, to, lang })}`,
    `supplier-statement-${from}-${to}.csv`,
  );
