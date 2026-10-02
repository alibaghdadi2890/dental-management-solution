import {
  auditPageSchema,
  duplicateGroupsSchema,
  owingCountSchema,
  patientCountsSchema,
  patientListItemSchema,
  patientPageSchema,
  patientSchema,
  type AuditPage,
  type DentitionOverride,
  type DuplicateCheckQuery,
  type ExportLanguage,
  type PatientArchive,
  type PatientCreateInput,
  type PatientListQuery,
  type PatientMerge,
  type PatientPatch,
  type PatientRestore,
} from '@dcm/contracts';
import { infiniteQueryOptions, type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { billingKeys } from '@/features/billing/billing-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { toSearch } from './list-query';

/**
 * The Patients list/record API client (design "Frontend" §Structure). `GET /patients` answers
 * `view=owing`, `sort=balance`, `view=notSeen` and `lastVisit=never` with 400 (design Q5, 4b);
 * those are served by `GET /billing/patients` instead, which otherwise returns the exact same page shape, so the list
 * page can treat the two routes as one data source.
 *
 * Every query key is scoped under the *acting* tenant (`catalogKeys`'s pattern,
 * `features/clinical/catalog/catalog-api.ts`) — a platform admin switching which clinic they're
 * managing must not see a stale cache from the clinic they just left, and `invalidatePatientData`
 * must be able to invalidate exactly one tenant's data, not every tenant's at once.
 */
export const patientKeys = {
  all: (tenantId: string | null) => ['patients', tenantId] as const,
  list: (tenantId: string | null, query: PatientListQuery) =>
    [...patientKeys.all(tenantId), 'list', query] as const,
  counts: (tenantId: string | null) => [...patientKeys.all(tenantId), 'counts'] as const,
  owingCount: (tenantId: string | null) => [...patientKeys.all(tenantId), 'owingCount'] as const,
  notSeenCount: (tenantId: string | null) =>
    [...patientKeys.all(tenantId), 'notSeenCount'] as const,
  duplicates: (tenantId: string | null) => [...patientKeys.all(tenantId), 'duplicates'] as const,
  duplicateCheck: (tenantId: string | null, query: DuplicateCheckQuery) =>
    [...patientKeys.all(tenantId), 'duplicateCheck', query] as const,
  detail: (tenantId: string | null, id: string) =>
    [...patientKeys.all(tenantId), 'detail', id] as const,
  audit: (tenantId: string | null, id: string) =>
    [...patientKeys.all(tenantId), 'audit', id] as const,
};

/** Omitted entirely (rather than sent as `{}`) when `tenantId` is left to the caller's ambient
 * acting tenant — `apiFetch` already defaults to `actingTenantId()` itself; this only forwards an
 * *explicit* tenant, matching `catalog-api.ts`'s `scope`. */
const scope = (tenantId?: string) => (tenantId === undefined ? {} : { tenantId });

/** The views composed from another module's data are served by `billing` (design Q5, 4b). */
function usesBillingRoute(query: PatientListQuery): boolean {
  return (
    query.view === 'owing' ||
    query.sort === 'balance' ||
    query.view === 'notSeen' ||
    query.lastVisit === 'never'
  );
}

/** Turns a plain string/number/undefined record into a `?a=1&b=2` query string, dropping any
 * `undefined` value — the one place every `GET` here builds its query string, so a param never
 * silently reaches the server as the literal text `"undefined"`. */
function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function patientListQuery(query: PatientListQuery, tenantId?: string) {
  const path = usesBillingRoute(query) ? '/billing/patients' : '/patients';
  return queryOptions({
    queryKey: patientKeys.list(tenantId ?? actingTenantId(), query),
    queryFn: () =>
      apiFetch(`${path}${toQueryString(toSearch(query))}`, patientPageSchema, scope(tenantId)),
  });
}

export function patientCountsQuery(tenantId?: string) {
  return queryOptions({
    queryKey: patientKeys.counts(tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/patients/counts', patientCountsSchema, scope(tenantId)),
  });
}

/** `GET /billing/patients/owing-count`: the "Owes balance" tab's count chip. */
export function owingCountQuery(tenantId?: string) {
  return queryOptions({
    queryKey: patientKeys.owingCount(tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/billing/patients/owing-count', owingCountSchema, scope(tenantId)),
  });
}

/** The Not seen tab chip: active patients without a counted visit in 180 days (4b, D18). */
export function notSeenCountQuery(tenantId?: string) {
  return queryOptions({
    queryKey: patientKeys.notSeenCount(tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/billing/patients/not-seen-count', owingCountSchema, scope(tenantId)),
  });
}

export function duplicatesQuery(tenantId?: string) {
  return queryOptions({
    queryKey: patientKeys.duplicates(tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/patients/duplicates', duplicateGroupsSchema, scope(tenantId)),
  });
}

/** The create/edit panel's debounced "possible duplicate" warning. */
export function duplicateCheckQuery(query: DuplicateCheckQuery, tenantId?: string) {
  return queryOptions({
    queryKey: patientKeys.duplicateCheck(tenantId ?? actingTenantId(), query),
    queryFn: () =>
      apiFetch(
        `/patients/duplicates/check${toQueryString(query)}`,
        z.array(patientListItemSchema),
        scope(tenantId),
      ),
  });
}

export function patientQuery(id: string, tenantId?: string) {
  return queryOptions({
    queryKey: patientKeys.detail(tenantId ?? actingTenantId(), id),
    queryFn: () => apiFetch(`/patients/${id}`, patientSchema, scope(tenantId)),
  });
}

/** The quick view's activity timeline (`audit:read` only, design Q10), newest first, one cursor
 * page at a time ("Show more"). */
export function patientAuditQuery(id: string, tenantId?: string) {
  return infiniteQueryOptions({
    queryKey: patientKeys.audit(tenantId ?? actingTenantId(), id),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiFetch(
        `/audit${toQueryString({ resourceType: 'patient', resourceId: id, cursor: pageParam })}`,
        auditPageSchema,
        scope(tenantId),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AuditPage) => page.nextCursor ?? undefined,
  });
}

/** `POST /patients`: the fields plus contacts linked in the same transaction (addendum C4). */
export function createPatient(input: PatientCreateInput) {
  return apiFetch('/patients', patientSchema, { method: 'POST', json: input });
}

export function updatePatient(id: string, patch: PatientPatch) {
  return apiFetch(`/patients/${id}`, patientSchema, { method: 'PATCH', json: patch });
}

/**
 * `PUT /patients/:id/dentition` (spec W14): sets or clears the chart's dentition override, from
 * the workspace's chart card header (`DentitionSelect`). Needs `visit:write`, not
 * `patient:write`.
 */
export function setDentition(id: string, input: DentitionOverride) {
  return apiFetch(`/patients/${id}/dentition`, patientSchema, { method: 'PUT', json: input });
}

/** Returns every affected patient (design "all-or-nothing"). */
export function archivePatients(input: PatientArchive) {
  return apiFetch('/patients/archive', z.array(patientSchema), { method: 'POST', json: input });
}

export function restorePatients(input: PatientRestore) {
  return apiFetch('/patients/restore', z.array(patientSchema), { method: 'POST', json: input });
}

/** Returns the kept patient. */
export function mergePatients(input: PatientMerge) {
  return apiFetch('/patients/merge', patientSchema, { method: 'POST', json: input });
}

/**
 * Invalidates every cached patients + billing query for one tenant (defaulting to the acting
 * tenant) — the one call every create/merge/archive/restore/opening-balance mutation should make
 * on success. `patientKeys.all`/`billingKeys.all` are prefixes of every more specific key
 * (including `owingCount`, `balances`, …), so invalidating just the two umbrellas covers all of
 * it; nothing under `userKeys` (`features/users/users-api.ts`) is invalidated, since no patient
 * mutation changes the practitioner list.
 */
export function invalidatePatientData(
  queryClient: QueryClient,
  tenantId: string | null = actingTenantId(),
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: patientKeys.all(tenantId) }),
    queryClient.invalidateQueries({ queryKey: billingKeys.all(tenantId) }),
  ]).then(() => undefined);
}

export type PatientExportRequest = { query: PatientListQuery } | { ids: readonly string[] };

function exportQueryString(request: PatientExportRequest, lang: ExportLanguage | undefined) {
  if ('ids' in request) {
    if (request.ids.length === 0) {
      throw new Error('Cannot export an empty patient selection');
    }
    return toQueryString({ ids: request.ids.join(','), lang });
  }
  const filtered = Object.fromEntries(
    Object.entries(toSearch(request.query)).filter(([key]) => key !== 'page' && key !== 'size'),
  );
  return toQueryString({ ...filtered, lang });
}

/**
 * `GET /billing/patients/export` (design "Export CSV" / the bulk bar's "Export"), saved through
 * `downloadCsv`. `{ ids: [] }` throws rather than silently falling back to exporting the whole
 * (unfiltered) view: the bulk bar's "Export" only ever means "the current selection", never
 * "everything".
 */
export async function downloadExport(
  request: PatientExportRequest,
  lang?: ExportLanguage,
): Promise<void> {
  await downloadCsv(`/billing/patients/export${exportQueryString(request, lang)}`, 'patients.csv');
}
