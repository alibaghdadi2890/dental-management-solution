import {
  type CancelLabOrderRequest,
  type CorrectLabTrip,
  type CreateLabOrderRequest,
  type CreateLabRequest,
  type CreateLabServiceRequest,
  type ExportLanguage,
  type HoldLabOrder,
  labAccountsSchema,
  labAdjustmentSchema,
  type LabOpeningBalance,
  labOpenOrdersSchema,
  type LabOrderListQuery,
  labOrderPageSchema,
  labOrderSchema,
  type LabOutcomeRequest,
  labPaymentSchema,
  labProposalSchema,
  labReportSchema,
  type LabReportGroup,
  labSchema,
  labServiceSchema,
  labStatementSchema,
  labTodaySchema,
  type LabUndoStep,
  type ReceiveLabOrdersRequest,
  type RecordLabAdjustment,
  type RecordLabPaymentRequest,
  type SendLabOrderRequest,
  type UpdateLabOrderRequest,
  type UpdateLabRequest,
  type UpdateLabServiceRequest,
} from '@dcm/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { IDEMPOTENCY_HEADER } from '@/lib/idempotency';

/** The orders list filter as the API takes it (paging aside). */
export type LabOrderFilter = Omit<LabOrderListQuery, 'cursor' | 'limit'>;

/**
 * The lab API (feature 18, `labs` module): the directory and price lists, orders and their
 * actions, the open orders behind every label, Today's lane, the accounts, statements and
 * reports. Keys are scoped under the acting tenant like the other features'; every write
 * invalidates the whole `labs` tree (open orders feed labels on several screens).
 */
export const labKeys = {
  all: (tenantId: string | null) => ['labs', tenantId] as const,
  labs: (tenantId: string | null, includeInactive: boolean) =>
    [...labKeys.all(tenantId), 'labs', includeInactive] as const,
  open: (tenantId: string | null) => [...labKeys.all(tenantId), 'open'] as const,
  orders: (tenantId: string | null, filter: LabOrderFilter) =>
    [...labKeys.all(tenantId), 'orders', filter] as const,
  order: (tenantId: string | null, id: string) => [...labKeys.all(tenantId), 'order', id] as const,
  today: (tenantId: string | null, branchId: string) =>
    [...labKeys.all(tenantId), 'today', branchId] as const,
  proposal: (tenantId: string | null, patientId: string, dentistId: string | undefined) =>
    [...labKeys.all(tenantId), 'proposal', patientId, dentistId ?? null] as const,
  accounts: (tenantId: string | null) => [...labKeys.all(tenantId), 'accounts'] as const,
  statement: (tenantId: string | null, labId: string, from: string, to: string) =>
    [...labKeys.all(tenantId), 'statement', labId, from, to] as const,
  reports: (tenantId: string | null, from: string, to: string, groupBy: LabReportGroup) =>
    [...labKeys.all(tenantId), 'reports', from, to, groupBy] as const,
};

function orderQuery(filter: LabOrderFilter & { lang?: ExportLanguage }): string {
  const params = new URLSearchParams();
  // Optional fields set to `undefined` are still own properties at runtime.
  for (const [key, value] of Object.entries(filter) as [
    string,
    string | readonly string[] | boolean | undefined,
  ][]) {
    if (value === undefined || value === '') continue;
    params.set(key, typeof value === 'object' ? value.join(',') : String(value));
  }
  return params.toString();
}

export function labsQuery(includeInactive = false, enabled = true) {
  return queryOptions({
    queryKey: labKeys.labs(actingTenantId(), includeInactive),
    queryFn: () =>
      apiFetch(`/labs${includeInactive ? '?includeInactive=true' : ''}`, z.array(labSchema)),
    staleTime: 60_000,
    enabled,
  });
}

/** Every open order: the labels on patients, appointments, the record, and the booking warning. */
export function openLabOrdersQuery(enabled = true) {
  return queryOptions({
    queryKey: labKeys.open(actingTenantId()),
    queryFn: () => apiFetch('/lab-orders/open', labOpenOrdersSchema),
    staleTime: 30_000,
    enabled,
  });
}

export function labOrdersQuery(filter: LabOrderFilter) {
  return queryOptions({
    queryKey: labKeys.orders(actingTenantId(), filter),
    queryFn: () => apiFetch(`/lab-orders?${orderQuery(filter)}&limit=100`, labOrderPageSchema),
  });
}

export function labOrderQuery(id: string) {
  return queryOptions({
    queryKey: labKeys.order(actingTenantId(), id),
    queryFn: () => apiFetch(`/lab-orders/${id}`, labOrderSchema),
  });
}

export function labTodayQuery(branchId: string, enabled = true) {
  return queryOptions({
    queryKey: labKeys.today(actingTenantId(), branchId),
    queryFn: () => apiFetch(`/lab-orders/today?branchId=${branchId}`, labTodaySchema),
    enabled,
  });
}

export function labProposalQuery(patientId: string, dentistId: string | undefined) {
  const params = new URLSearchParams({ patientId });
  if (dentistId) params.set('dentistId', dentistId);
  return queryOptions({
    queryKey: labKeys.proposal(actingTenantId(), patientId, dentistId),
    queryFn: () => apiFetch(`/lab-orders/proposal?${params.toString()}`, labProposalSchema),
  });
}

export function labAccountsQuery(enabled = true) {
  return queryOptions({
    queryKey: labKeys.accounts(actingTenantId()),
    queryFn: () => apiFetch('/labs/accounts', labAccountsSchema),
    enabled,
  });
}

export function labStatementQuery(labId: string, from: string, to: string) {
  return queryOptions({
    queryKey: labKeys.statement(actingTenantId(), labId, from, to),
    queryFn: () => apiFetch(`/labs/${labId}/statement?from=${from}&to=${to}`, labStatementSchema),
  });
}

export function labReportsQuery(from: string, to: string, groupBy: LabReportGroup) {
  return queryOptions({
    queryKey: labKeys.reports(actingTenantId(), from, to, groupBy),
    queryFn: () =>
      apiFetch(`/labs/reports?from=${from}&to=${to}&groupBy=${groupBy}`, labReportSchema),
  });
}

/** Every lab read of the acting clinic, after any write. */
export function invalidateLabs(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: labKeys.all(actingTenantId()) });
}

// --- Labs ---

export function createLab(input: CreateLabRequest) {
  return apiFetch('/labs', labSchema, { method: 'POST', json: input });
}

export function updateLab(id: string, input: UpdateLabRequest) {
  return apiFetch(`/labs/${id}`, labSchema, { method: 'PATCH', json: input });
}

export function createLabService(labId: string, input: CreateLabServiceRequest) {
  return apiFetch(`/labs/${labId}/services`, labServiceSchema, { method: 'POST', json: input });
}

export function updateLabService(labId: string, id: string, input: UpdateLabServiceRequest) {
  return apiFetch(`/labs/${labId}/services/${id}`, labServiceSchema, {
    method: 'PATCH',
    json: input,
  });
}

export function setOpeningBalance(labId: string, input: LabOpeningBalance) {
  return apiFetch(`/labs/${labId}/opening-balance`, labSchema, { method: 'PUT', json: input });
}

export function recordLabPayment(labId: string, input: RecordLabPaymentRequest, key: string) {
  return apiFetch(`/labs/${labId}/payments`, labPaymentSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: key },
  });
}

export function voidLabPayment(id: string, reason: string) {
  return apiFetch(`/labs/payments/${id}/void`, labPaymentSchema, {
    method: 'POST',
    json: { reason },
  });
}

export function recordLabAdjustment(labId: string, input: RecordLabAdjustment, key: string) {
  return apiFetch(`/labs/${labId}/adjustments`, labAdjustmentSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: key },
  });
}

export function downloadLabStatement(
  labId: string,
  from: string,
  to: string,
  lang?: ExportLanguage,
) {
  return downloadCsv(
    `/labs/${labId}/statement/export?from=${from}&to=${to}${lang ? `&lang=${lang}` : ''}`,
    `lab-statement-${from}-${to}.csv`,
  );
}

// --- Orders ---

export function createLabOrder(input: CreateLabOrderRequest, key: string) {
  return apiFetch('/lab-orders', labOrderSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: key },
  });
}

export function updateLabOrder(id: string, input: UpdateLabOrderRequest) {
  return apiFetch(`/lab-orders/${id}`, labOrderSchema, { method: 'PATCH', json: input });
}

const act = (id: string, action: string, json: unknown = {}) =>
  apiFetch(`/lab-orders/${id}/${action}`, labOrderSchema, { method: 'POST', json });

export const sendLabOrder = (id: string, input: SendLabOrderRequest) => act(id, 'send', input);
export const expectLabOrder = (id: string, expectedOn: string) =>
  act(id, 'expected', { expectedOn });
export const labOutcome = (id: string, input: LabOutcomeRequest) => act(id, 'outcome', input);
export const holdLabOrder = (id: string, input: HoldLabOrder) => act(id, 'hold', input);
export const resumeLabOrder = (id: string) => act(id, 'resume');
export const cancelLabOrder = (id: string, input: CancelLabOrderRequest) =>
  act(id, 'cancel', input);
export const undoLabOrder = (id: string, step: LabUndoStep) => act(id, 'undo', { step });
export const linkLabOrder = (id: string, appointmentId: string | null) =>
  act(id, 'link', { appointmentId });
export const attachLabFiles = (id: string, fileIds: string[]) =>
  act(id, 'attachments', { fileIds });

export function correctLabTrip(id: string, seq: number, input: CorrectLabTrip) {
  return apiFetch(`/lab-orders/${id}/trips/${String(seq)}`, labOrderSchema, {
    method: 'PATCH',
    json: input,
  });
}

export function receiveLabOrders(input: ReceiveLabOrdersRequest) {
  return apiFetch('/lab-orders/receive', z.array(labOrderSchema), { method: 'POST', json: input });
}

export function downloadLabOrders(filter: LabOrderFilter, lang?: ExportLanguage) {
  return downloadCsv(
    `/lab-orders/export?${orderQuery({ ...filter, ...(lang ? { lang } : {}) })}`,
    'lab-orders.csv',
  );
}
