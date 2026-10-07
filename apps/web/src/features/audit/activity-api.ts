import {
  type ActivityArea,
  type AuditPage,
  auditPageSchema,
  formatReceiptNumber,
  formatVisitNumber,
  patientNameSchema,
  patientPageSchema,
  transactionPageSchema,
  visitNumberSchema,
  visitPageSchema,
} from '@dcm/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import type { SearchTerm } from './activity-search';

/**
 * The Activity screen's reads (feature 7, H7): the audit feed, the names of the patients and
 * visits its rows are about (the log holds ids), and what a typed search refers to. Keys are
 * scoped under the acting tenant, like every other feature's.
 */
export const activityKeys = {
  all: (tenantId: string | null) => ['activity', tenantId] as const,
  feed: (tenantId: string | null, filters: FeedFilters) =>
    [...activityKeys.all(tenantId), 'feed', filters] as const,
  patients: (tenantId: string | null, ids: readonly string[]) =>
    [...activityKeys.all(tenantId), 'patients', ids] as const,
  visits: (tenantId: string | null, ids: readonly string[]) =>
    [...activityKeys.all(tenantId), 'visits', ids] as const,
  search: (tenantId: string | null, text: string, staff: number) =>
    [...activityKeys.all(tenantId), 'search', text, staff] as const,
};

/** What narrows the feed; every field maps to one `GET /audit` parameter. */
export interface FeedFilters {
  area?: ActivityArea | undefined;
  actorUserId?: string | undefined;
  platformAdmin?: boolean | undefined;
  from?: string | undefined;
  patientId?: string | undefined;
  visitId?: string | undefined;
  /** One payment's rows (a receipt found by its number). */
  paymentId?: string | undefined;
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** How many rows one "Load more" brings. */
const PAGE_SIZE = 40;

export function activityFeedQuery(filters: FeedFilters) {
  return infiniteQueryOptions({
    queryKey: activityKeys.feed(actingTenantId(), filters),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiFetch(
        `/audit${queryString({
          feed: true,
          limit: PAGE_SIZE,
          area: filters.area,
          actorUserId: filters.actorUserId,
          platformAdmin: filters.platformAdmin,
          from: filters.from,
          patientId: filters.patientId,
          visitId: filters.visitId,
          ...(filters.paymentId ? { resourceType: 'payment', resourceId: filters.paymentId } : {}),
          cursor: pageParam,
        })}`,
        auditPageSchema,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AuditPage) => page.nextCursor ?? undefined,
    // A log: whatever was just done elsewhere in the app must be there when the screen opens.
    staleTime: 0,
  });
}

/** The lookups take at most this many ids; one page of the feed (`PAGE_SIZE` rows) never names
 * more, and the screen asks once per page. */
const MAX_IDS = 100;
const sorted = (ids: readonly string[]) => [...new Set(ids)].sort().slice(0, MAX_IDS);

export function patientNamesQuery(ids: readonly string[]) {
  const wanted = sorted(ids);
  return queryOptions({
    queryKey: activityKeys.patients(actingTenantId(), wanted),
    queryFn: () => apiFetch(`/patients/names?ids=${wanted.join(',')}`, z.array(patientNameSchema)),
    enabled: wanted.length > 0,
    staleTime: 60_000,
  });
}

export function visitNumbersQuery(ids: readonly string[]) {
  const wanted = sorted(ids);
  return queryOptions({
    queryKey: activityKeys.visits(actingTenantId(), wanted),
    queryFn: () => apiFetch(`/visits/numbers?ids=${wanted.join(',')}`, z.array(visitNumberSchema)),
    enabled: wanted.length > 0,
    staleTime: 60_000,
  });
}

/** What a typed search narrows the feed to; `null` when it names nothing the clinic has. */
export type SearchMatch = Pick<FeedFilters, 'patientId' | 'visitId' | 'paymentId' | 'actorUserId'>;

const digits = (text: string) => Number(text.replace(/\D/g, ''));

/**
 * Resolves a search (D20) through the lists the app already has: `P-12`, `V-45` and `RCT-3` to
 * that patient, visit or receipt; other text to a staff member whose name contains it (what they
 * did), else to the patient it finds first (what was done about them).
 */
export async function resolveSearch(
  term: SearchTerm,
  staff: ReadonlyMap<string, string>,
): Promise<SearchMatch | null> {
  const q = encodeURIComponent(term.text);
  if (term.kind === 'visitNumber') {
    const page = await apiFetch(`/visits?tab=all&range=all&limit=10&q=${q}`, visitPageSchema);
    const wanted = formatVisitNumber(digits(term.text));
    const visit = page.items.find((item) => formatVisitNumber(item.displayNumber) === wanted);
    return visit ? { visitId: visit.id } : null;
  }
  if (term.kind === 'receiptNumber') {
    const page = await apiFetch(
      `/billing/payments?range=all&limit=10&q=${q}`,
      transactionPageSchema,
    );
    const wanted = formatReceiptNumber(digits(term.text));
    const payment = page.items.find(
      (item) => item.kind === 'payment' && formatReceiptNumber(item.receiptNumber) === wanted,
    );
    return payment ? { paymentId: payment.id } : null;
  }
  if (term.kind === 'name') {
    const needle = term.text.toLocaleLowerCase();
    const actor = [...staff].find(([, name]) => name.toLocaleLowerCase().includes(needle));
    if (actor) return { actorUserId: actor[0] };
  }
  const page = await apiFetch(`/patients?size=10&q=${q}`, patientPageSchema);
  const patient =
    term.kind === 'patientNumber'
      ? page.items.find((item) => digits(item.displayNumber) === digits(term.text))
      : page.items[0];
  return patient ? { patientId: patient.id } : null;
}

export function searchQuery(term: SearchTerm | null, staff: ReadonlyMap<string, string>) {
  return queryOptions({
    // The staff list is part of the answer (a name may be a staff member's): a search resolved
    // before it loaded is resolved again once it has.
    queryKey: activityKeys.search(actingTenantId(), term?.text ?? '', staff.size),
    queryFn: () => (term ? resolveSearch(term, staff) : null),
    enabled: term !== null,
    staleTime: 30_000,
  });
}
