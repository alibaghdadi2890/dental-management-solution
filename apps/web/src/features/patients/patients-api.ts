import {
  auditPageSchema,
  duplicateGroupsSchema,
  owingCountSchema,
  patientCountsSchema,
  patientListItemSchema,
  patientPageSchema,
  patientSchema,
  practitionerSchema,
  type DuplicateCheckQuery,
  type ExportLanguage,
  type PatientArchive,
  type PatientInput,
  type PatientListQuery,
  type PatientMerge,
  type PatientPatch,
  type PatientRestore,
} from '@dcm/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { billingKeys } from '@/features/billing/billing-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { API_BASE, apiFetch, TENANT_HEADER, toApiError } from '@/lib/api';
import { toSearch } from './list-query';

/**
 * The Patients list/record API client (design "Frontend" §Structure). `GET /patients` answers
 * `view=owing` and `sort=balance` with 400 (design Q5); those two cases are served by
 * `GET /billing/patients` instead, which otherwise returns the exact same page shape, so the list
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
  duplicates: (tenantId: string | null) => [...patientKeys.all(tenantId), 'duplicates'] as const,
  duplicateCheck: (tenantId: string | null, query: DuplicateCheckQuery) =>
    [...patientKeys.all(tenantId), 'duplicateCheck', query] as const,
  detail: (tenantId: string | null, id: string) =>
    [...patientKeys.all(tenantId), 'detail', id] as const,
  audit: (tenantId: string | null, id: string) =>
    [...patientKeys.all(tenantId), 'audit', id] as const,
};

/** `GET /users/practitioners` belongs to `users`, not `patients` — its own key namespace, even
 * though the query factory lives beside the patients form that's the only consumer so far. */
export const userKeys = {
  practitioners: (tenantId: string | null) => ['users', tenantId, 'practitioners'] as const,
};

/** Omitted entirely (rather than sent as `{}`) when `tenantId` is left to the caller's ambient
 * acting tenant — `apiFetch` already defaults to `actingTenantId()` itself; this only forwards an
 * *explicit* tenant, matching `catalog-api.ts`'s `scope`. */
const scope = (tenantId?: string) => (tenantId === undefined ? {} : { tenantId });

function usesBillingRoute(query: PatientListQuery): boolean {
  return query.view === 'owing' || query.sort === 'balance';
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

/** `GET /users/practitioners`: the "Primary dentist" select and the merge/quick-view dentist name. */
export function practitionersQuery(tenantId?: string) {
  return queryOptions({
    queryKey: userKeys.practitioners(tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/users/practitioners', z.array(practitionerSchema), scope(tenantId)),
  });
}

/** The quick view's activity timeline (`audit:read` only, design Q10); the first page only — an
 * infinite/"load more" query is a concern for the component that renders it, not this client. */
export function patientAuditQuery(id: string, tenantId?: string) {
  return queryOptions({
    queryKey: patientKeys.audit(tenantId ?? actingTenantId(), id),
    queryFn: () =>
      apiFetch(
        `/audit${toQueryString({ resourceType: 'patient', resourceId: id })}`,
        auditPageSchema,
        scope(tenantId),
      ),
  });
}

export function createPatient(input: PatientInput) {
  return apiFetch('/patients', patientSchema, { method: 'POST', json: input });
}

export function updatePatient(id: string, patch: PatientPatch) {
  return apiFetch(`/patients/${id}`, patientSchema, { method: 'PATCH', json: patch });
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
 * it; nothing under `userKeys` is invalidated, since no patient mutation changes the practitioner
 * list.
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

const CONTENT_DISPOSITION_FILENAME = /filename="?([^";]+)"?/i;

function filenameFrom(contentDisposition: string | null, fallback: string): string {
  const match = contentDisposition ? CONTENT_DISPOSITION_FILENAME.exec(contentDisposition) : null;
  return match?.[1] ?? fallback;
}

/** Saves a blob the same way a plain `<a download>` click would — the one place this SPA triggers
 * a browser file save, kept tiny so a test can stub `URL.createObjectURL`/`revokeObjectURL` and
 * the anchor's `click()` without touching the request logic above it. The anchor is briefly
 * attached to the document (Firefox ignores `download` on a detached element) and the object URL
 * is revoked a macrotask later, not synchronously (Firefox can also drop the download if the URL
 * is revoked before it's had a turn to actually start reading it). */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * `GET /billing/patients/export` (design "Export CSV" / the bulk bar's "Export"): a manual
 * `fetch`, not `apiFetch` — the response is a CSV file, not JSON, so `apiFetch`'s schema
 * validation doesn't apply — but every other convention it enforces (the versioned API base, the
 * session cookie, the acting tenant header, a typed `ApiError` on failure) still does. `{ ids: [] }`
 * throws rather than silently falling back to exporting the whole (unfiltered) view: the bulk
 * bar's "Export" only ever means "the current selection", never "everything".
 */
export async function downloadExport(
  request: PatientExportRequest,
  lang?: ExportLanguage,
): Promise<void> {
  const search = exportQueryString(request, lang);
  const headers = new Headers({ Accept: 'text/csv' });
  const tenantId = actingTenantId();
  if (tenantId) headers.set(TENANT_HEADER, tenantId);

  const response = await fetch(`${API_BASE}/billing/patients/export${search}`, {
    credentials: 'same-origin',
    headers,
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const blob = await response.blob();
  saveBlob(blob, filenameFrom(response.headers.get('content-disposition'), 'patients.csv'));
}
