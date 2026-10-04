import {
  type ExportLanguage,
  familySchema,
  familyStatementSchema,
  type OutstandingQuery,
  outstandingPageSchema,
  patientAccountSchema,
  type PaymentRequest,
  paymentWriteResultSchema,
  receiptSchema,
  receivablesSchema,
  recordPaymentResultSchema,
  type RefundInput,
  statementSchema,
  type TransactionFilters,
  type TransactionQuery,
  transactionPageSchema,
  type VoidPaymentInput,
} from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { billingKeys } from './billing-api';

/**
 * Payments (feature 5): the account, the payment panel's preview and record, refunds and voids,
 * the Payments screen's reads and the printables' data. Keys sit under `billingKeys.all`, so
 * one invalidation after a payment refreshes every balance.
 */
export const paymentKeys = {
  account: (tenantId: string | null, patientId: string, payerContactId?: string) =>
    [...billingKeys.all(tenantId), 'account', patientId, payerContactId ?? null] as const,
  family: (tenantId: string | null, contactId: string) =>
    [...billingKeys.all(tenantId), 'family', contactId] as const,
  familyStatement: (tenantId: string | null, contactId: string) =>
    [...billingKeys.all(tenantId), 'family-statement', contactId] as const,
  transactions: (tenantId: string | null, query: TransactionQuery) =>
    [...billingKeys.all(tenantId), 'transactions', query] as const,
  aging: (tenantId: string | null) => [...billingKeys.all(tenantId), 'aging'] as const,
  outstanding: (tenantId: string | null, query: OutstandingQuery) =>
    [...billingKeys.all(tenantId), 'outstanding', query] as const,
  receipt: (tenantId: string | null, paymentId: string) =>
    [...billingKeys.all(tenantId), 'receipt', paymentId] as const,
  statement: (tenantId: string | null, patientId: string) =>
    [...billingKeys.all(tenantId), 'statement', patientId] as const,
};

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const filterParams = (filters: TransactionFilters) => ({
  range: filters.range,
  method: filters.method,
  kind: filters.kind,
  q: filters.q,
  patientId: filters.patientId,
});

/** `GET /billing/patients/:id/account`: balance card, open charges, payers, history; with
 * `payerContactId`, the panel's payer and household for that payer. */
export function accountQuery(patientId: string, payerContactId?: string) {
  return queryOptions({
    queryKey: paymentKeys.account(actingTenantId(), patientId, payerContactId),
    queryFn: () =>
      apiFetch(
        `/billing/patients/${patientId}/account${queryString({ payerContactId })}`,
        patientAccountSchema,
      ),
  });
}

/** `GET /billing/contacts/:id/family`: a billing contact's family and what it owes. */
export function familyQuery(contactId: string) {
  return queryOptions({
    queryKey: paymentKeys.family(actingTenantId(), contactId),
    queryFn: () => apiFetch(`/billing/contacts/${contactId}/family`, familySchema),
  });
}

export function familyStatementQuery(contactId: string) {
  return queryOptions({
    queryKey: paymentKeys.familyStatement(actingTenantId(), contactId),
    queryFn: () =>
      apiFetch(`/billing/contacts/${contactId}/family/statement`, familyStatementSchema),
  });
}

/** `POST /billing/payments`; `key` is the panel's Idempotency-Key, the same on a retry (P11). */
export function recordPayment(input: PaymentRequest, key: string) {
  return apiFetch('/billing/payments', recordPaymentResultSchema, {
    method: 'POST',
    json: input,
    headers: { 'Idempotency-Key': key },
  });
}

export function refundPayment(paymentId: string, input: RefundInput) {
  return apiFetch(`/billing/payments/${paymentId}/refund`, paymentWriteResultSchema, {
    method: 'POST',
    json: input,
  });
}

export function voidPayment(paymentId: string, input: VoidPaymentInput) {
  return apiFetch(`/billing/payments/${paymentId}/void`, paymentWriteResultSchema, {
    method: 'POST',
    json: input,
  });
}

export function transactionsQuery(query: TransactionQuery) {
  return queryOptions({
    queryKey: paymentKeys.transactions(actingTenantId(), query),
    queryFn: () =>
      apiFetch(
        `/billing/payments${queryString({
          ...filterParams(query),
          limit: query.limit,
          cursor: query.cursor,
        })}`,
        transactionPageSchema,
      ),
  });
}

export function agingQuery() {
  return queryOptions({
    queryKey: paymentKeys.aging(actingTenantId()),
    queryFn: () => apiFetch('/billing/aging', receivablesSchema),
  });
}

export function outstandingQuery(query: OutstandingQuery) {
  return queryOptions({
    queryKey: paymentKeys.outstanding(actingTenantId(), query),
    queryFn: () =>
      apiFetch(
        `/billing/outstanding${queryString({
          group: query.group,
          bucket: query.bucket,
          q: query.q,
          limit: query.limit,
          cursor: query.cursor,
        })}`,
        outstandingPageSchema,
      ),
  });
}

export function receiptQuery(paymentId: string) {
  return queryOptions({
    queryKey: paymentKeys.receipt(actingTenantId(), paymentId),
    queryFn: () => apiFetch(`/billing/payments/${paymentId}/receipt`, receiptSchema),
  });
}

export function statementQuery(patientId: string) {
  return queryOptions({
    queryKey: paymentKeys.statement(actingTenantId(), patientId),
    queryFn: () => apiFetch(`/billing/patients/${patientId}/statement`, statementSchema),
  });
}

export function downloadTransactionsExport(
  filters: TransactionFilters,
  lang: ExportLanguage | undefined,
): Promise<void> {
  return downloadCsv(
    `/billing/payments/export${queryString({ ...filterParams(filters), lang })}`,
    'payments.csv',
  );
}

/**
 * The printable pages (B9): opened in a new tab so the record stays where it was. Opened with an
 * opener so the browser copies sessionStorage (a platform admin's acting clinic), which is then
 * cut.
 */
export const printPath = {
  receipt: (paymentId: string) => `/print/receipt/${paymentId}`,
  invoice: (visitId: string) => `/print/invoice/${visitId}`,
  statement: (patientId: string) => `/print/statement/${patientId}`,
  familyStatement: (contactId: string) => `/print/family-statement/${contactId}`,
  quote: (patientId: string) => `/print/quote/${patientId}`,
};

export function openPrintable(path: string): void {
  const opened = window.open(path, '_blank');
  if (opened) opened.opener = null;
}
