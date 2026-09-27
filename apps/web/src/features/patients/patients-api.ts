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
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { API_BASE, apiFetch } from '@/lib/api';
import { toSearch } from './list-query';

/**
 * The Patients list/record API client (design "Frontend" §Structure). `GET /patients` answers
 * `view=owing` and `sort=balance` with 400 (design Q5); those two cases are served by
 * `GET /billing/patients` instead, which otherwise returns the exact same page shape, so the list
 * page can treat the two routes as one data source.
 */
export const patientKeys = {
  all: ['patients'] as const,
  list: (query: PatientListQuery) => ['patients', 'list', query] as const,
  counts: ['patients', 'counts'] as const,
  owingCount: ['patients', 'owingCount'] as const,
  duplicates: ['patients', 'duplicates'] as const,
  duplicateCheck: (query: DuplicateCheckQuery) => ['patients', 'duplicateCheck', query] as const,
  detail: (id: string) => ['patients', 'detail', id] as const,
  practitioners: ['patients', 'practitioners'] as const,
  audit: (id: string) => ['patients', 'audit', id] as const,
};

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

export function patientListQuery(query: PatientListQuery) {
  const path = usesBillingRoute(query) ? '/billing/patients' : '/patients';
  return queryOptions({
    queryKey: patientKeys.list(query),
    queryFn: () => apiFetch(`${path}${toQueryString(toSearch(query))}`, patientPageSchema),
  });
}

export function patientCountsQuery() {
  return queryOptions({
    queryKey: patientKeys.counts,
    queryFn: () => apiFetch('/patients/counts', patientCountsSchema),
  });
}

/** `GET /billing/patients/owing-count`: the "Owes balance" tab's count chip. */
export function owingCountQuery() {
  return queryOptions({
    queryKey: patientKeys.owingCount,
    queryFn: () => apiFetch('/billing/patients/owing-count', owingCountSchema),
  });
}

export function duplicatesQuery() {
  return queryOptions({
    queryKey: patientKeys.duplicates,
    queryFn: () => apiFetch('/patients/duplicates', duplicateGroupsSchema),
  });
}

/** The create/edit panel's debounced "possible duplicate" warning. */
export function duplicateCheckQuery(query: DuplicateCheckQuery) {
  return queryOptions({
    queryKey: patientKeys.duplicateCheck(query),
    queryFn: () =>
      apiFetch(`/patients/duplicates/check${toQueryString(query)}`, z.array(patientListItemSchema)),
  });
}

export function patientQuery(id: string) {
  return queryOptions({
    queryKey: patientKeys.detail(id),
    queryFn: () => apiFetch(`/patients/${id}`, patientSchema),
  });
}

/** `GET /users/practitioners`: the "Primary dentist" select and the merge/quick-view dentist name. */
export function practitionersQuery() {
  return queryOptions({
    queryKey: patientKeys.practitioners,
    queryFn: () => apiFetch('/users/practitioners', z.array(practitionerSchema)),
  });
}

/** The quick view's activity timeline (`audit:read` only, design Q10); the first page only — an
 * infinite/"load more" query is a concern for the component that renders it, not this client. */
export function patientAuditQuery(id: string) {
  return queryOptions({
    queryKey: patientKeys.audit(id),
    queryFn: () =>
      apiFetch(
        `/audit${toQueryString({ resourceType: 'patient', resourceId: id })}`,
        auditPageSchema,
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
 * `GET /billing/patients/export`'s URL — a plain string for an `<a href>`/`window.open`, not an
 * `apiFetch` call: the response is a CSV file, not JSON. `queryOrIds` is either the list's current
 * filters (the header's "Export CSV") or an explicit id list (the bulk bar's "Export" on the
 * current selection); paging never applies to an export.
 */
export function exportUrl(
  // A mutable `string[]`, not `readonly string[]`: `Array.isArray` doesn't narrow a union away
  // from a `readonly` array type (it asserts the mutable `any[]`, which a `readonly` array isn't
  // assignable to), so a `readonly` element here would leave `queryOrIds` a union in both branches.
  queryOrIds: PatientListQuery | string[],
  lang?: ExportLanguage,
): string {
  const params: Record<string, string | number | undefined> = Array.isArray(queryOrIds)
    ? { ids: queryOrIds.length > 0 ? queryOrIds.join(',') : undefined }
    : Object.fromEntries(
        Object.entries(toSearch(queryOrIds)).filter(([key]) => key !== 'page' && key !== 'size'),
      );
  return `${API_BASE}/billing/patients/export${toQueryString({ ...params, lang })}`;
}
