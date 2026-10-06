import {
  auditPageSchema,
  unpaidVisitsSummarySchema,
  visitBalanceSchema,
  visitListSummarySchema,
  visitPageSchema,
  visitResultSchema,
  type AmendVisitInput,
  type AuditPage,
  type CheckoutDiscountInput,
  type ExportLanguage,
  type VisitFilters,
  type VisitListQuery,
  type VisitPage,
  type VoidVisitInput,
} from '@dcm/contracts';
import { infiniteQueryOptions, type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { billingKeys } from '@/features/billing/billing-api';
import { patientKeys } from '@/features/patients/patients-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { clinicalKeys, visitKeys } from '../visits-api';
import { filterParams, type VisitTab } from './visits-search';

/**
 * The Visits screen's reads and the amend/void writes (4b, spec §Frontend): `clinical`'s
 * `GET /visits` and `/visits/summary`, `billing`'s Unpaid tab, visit balances and export, and the
 * visit's audit trail. Keys sit under `visitKeys.all` (and `billingKeys.all` for money), scoped
 * by the acting tenant like every other key.
 */
export const visitListKeys = {
  lists: (tenantId: string | null) => [...visitKeys.all(tenantId), 'list'] as const,
  list: (tenantId: string | null, unpaid: boolean, query: VisitListQuery) =>
    [...visitListKeys.lists(tenantId), unpaid ? 'unpaid' : 'visits', query] as const,
  summary: (tenantId: string | null, unpaid: boolean, filters: VisitFilters) =>
    [...visitListKeys.lists(tenantId), 'summary', unpaid ? 'unpaid' : 'visits', filters] as const,
  audit: (tenantId: string | null, visitId: string) =>
    [...visitKeys.all(tenantId), 'audit', visitId] as const,
  balances: (tenantId: string | null, ids: readonly string[]) =>
    [...billingKeys.all(tenantId), 'visit-balances', [...ids].sort()] as const,
};

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const listParams = (query: VisitListQuery) => ({
  ...filterParams(query),
  limit: query.limit,
  cursor: query.cursor,
});

/** One cursor page: the clinic's visits, or with `unpaid` the visits still owing (`billing`). */
export function visitPageQuery(query: VisitListQuery, unpaid: boolean) {
  return queryOptions({
    queryKey: visitListKeys.list(actingTenantId(), unpaid, query),
    queryFn: () =>
      apiFetch(
        `${unpaid ? '/billing/visits/unpaid' : '/visits'}${queryString(listParams(query))}`,
        visitPageSchema,
      ),
  });
}

/** A patient's visits in every branch, newest first, completed / amended / voided (the record's
 * Visits & history tab), a page at a time behind "Load more". */
export function patientVisitsQuery(patientId: string) {
  return infiniteQueryOptions({
    queryKey: [...visitListKeys.lists(actingTenantId()), 'patient', patientId] as const,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiFetch(
        `/visits${queryString({ patientId, tab: 'history', range: 'all', limit: 20, cursor: pageParam })}`,
        visitPageSchema,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: VisitPage) => page.nextCursor ?? undefined,
  });
}

/** The footer and the tab chips (`/visits/summary`). */
export function visitListSummaryQuery(filters: VisitFilters) {
  return queryOptions({
    queryKey: visitListKeys.summary(actingTenantId(), false, filters),
    queryFn: () =>
      apiFetch(`/visits/summary${queryString(filterParams(filters))}`, visitListSummarySchema),
  });
}

/** The Unpaid footer and its tab chip (`billing`, `payment:read`). */
export function unpaidSummaryQuery(filters: VisitFilters, enabled: boolean) {
  return queryOptions({
    queryKey: visitListKeys.summary(actingTenantId(), true, filters),
    queryFn: () =>
      apiFetch(
        `/billing/visits/unpaid/summary${queryString(filterParams(filters))}`,
        unpaidVisitsSummarySchema,
      ),
    enabled,
  });
}

/** Paid and balance of the visible visits (`payment:read`); none asked for an empty page. */
export function visitBalancesQuery(ids: readonly string[], enabled: boolean) {
  return queryOptions({
    queryKey: visitListKeys.balances(actingTenantId(), ids),
    queryFn: () =>
      apiFetch(`/billing/visits/balances?visitIds=${ids.join(',')}`, z.array(visitBalanceSchema)),
    enabled: enabled && ids.length > 0,
  });
}

/** The detail panel's trail (`audit:read`), newest first, a page at a time. */
export function visitAuditQuery(visitId: string) {
  return infiniteQueryOptions({
    queryKey: visitListKeys.audit(actingTenantId(), visitId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiFetch(
        `/audit${queryString({ resourceType: 'visit', resourceId: visitId, cursor: pageParam })}`,
        auditPageSchema,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AuditPage) => page.nextCursor ?? undefined,
  });
}

/** The current tab and filters as CSV (`GET /billing/visits/export`). */
export function downloadVisitsExport(
  tab: VisitTab,
  filters: VisitFilters,
  lang: ExportLanguage | undefined,
): Promise<void> {
  const params = { ...filterParams(filters), tab, lang };
  return downloadCsv(`/billing/visits/export${queryString(params)}`, 'visits.csv');
}

export function amendVisit(visitId: string, input: AmendVisitInput) {
  return apiFetch(`/visits/${visitId}/amend`, visitResultSchema, { method: 'POST', json: input });
}

/** The visit discount set at checkout (`visit:discount`, the visit's day only). */
export function checkoutDiscount(visitId: string, input: CheckoutDiscountInput) {
  return apiFetch(`/visits/${visitId}/checkout-discount`, visitResultSchema, {
    method: 'POST',
    json: input,
  });
}

/** Closes a completed visit's checkout without a payment (`payment:write`, ADR-0033). */
export function checkOutVisit(visitId: string) {
  return apiFetch(`/visits/${visitId}/checkout`, visitResultSchema, { method: 'POST' });
}

export function voidVisit(visitId: string, input: VoidVisitInput) {
  return apiFetch(`/visits/${visitId}/void`, visitResultSchema, { method: 'POST', json: input });
}

/**
 * After an amend, a checkout discount or a void: the lists, summaries and trails (`visitKeys`), the money
 * (`billingKeys`: balances, visit summaries, the patients' balances), the clinical record
 * (`clinicalKeys`: chart, last visit, stats) and the patients list (Last visit, Not seen).
 */
export function invalidateVisitData(queryClient: QueryClient): Promise<void> {
  const tenantId = actingTenantId();
  return Promise.all(
    [visitKeys.all, billingKeys.all, clinicalKeys.all, patientKeys.all].map((key) =>
      queryClient.invalidateQueries({ queryKey: key(tenantId) }),
    ),
  ).then(() => undefined);
}
