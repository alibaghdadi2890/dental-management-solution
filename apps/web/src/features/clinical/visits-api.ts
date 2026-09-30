import {
  clinicalSummarySchema,
  diagnosisResultSchema,
  lastVisitSchema,
  liveVisitRefSchema,
  patientChartSchema,
  planResultSchema,
  serviceResultSchema,
  startDefaultsSchema,
  startVisitResultSchema,
  toothHistorySchema,
  toothPresenceResultSchema,
  visitResultSchema,
  visitSchema,
  type AddServiceInput,
  type LiveVisitQuery,
  type PlanTreatmentInput,
  type RecordDiagnosisInput,
  type StartVisitInput,
  type ToothCode,
  type ToothPresence,
  type UpdateServiceInput,
  type VisitDiscountInput,
  type VisitNotesInput,
} from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/**
 * The live visit and the patient's clinical reads (feature 4a, spec §HTTP): `clinical`'s
 * `/visits` and `/clinical/patients` routes. `visit-mutations.ts` has the cache effects of the
 * writes.
 *
 * Every key is scoped under the acting tenant (`patientKeys`'s pattern,
 * `features/patients/patients-api.ts`), so a platform admin switching clinics never sees a stale
 * visit or chart from the clinic they left.
 */
export const visitKeys = {
  all: (tenantId: string | null) => ['visits', tenantId] as const,
  detail: (tenantId: string | null, id: string) =>
    [...visitKeys.all(tenantId), 'detail', id] as const,
  allLive: (tenantId: string | null) => [...visitKeys.all(tenantId), 'live'] as const,
  live: (tenantId: string | null, filter: LiveVisitQuery) =>
    [...visitKeys.allLive(tenantId), filter] as const,
  startDefaults: (tenantId: string | null) =>
    [...visitKeys.all(tenantId), 'start-defaults'] as const,
};

export const clinicalKeys = {
  all: (tenantId: string | null) => ['clinical', tenantId] as const,
  chart: (tenantId: string | null, patientId: string) =>
    [...clinicalKeys.all(tenantId), 'chart', patientId] as const,
  toothHistories: (tenantId: string | null, patientId: string) =>
    [...clinicalKeys.all(tenantId), 'tooth-history', patientId] as const,
  toothHistory: (tenantId: string | null, patientId: string, toothCode: ToothCode) =>
    [...clinicalKeys.toothHistories(tenantId, patientId), toothCode] as const,
  summary: (tenantId: string | null, patientId: string) =>
    [...clinicalKeys.all(tenantId), 'summary', patientId] as const,
  lastVisit: (tenantId: string | null, patientId: string) =>
    [...clinicalKeys.all(tenantId), 'last-visit', patientId] as const,
};

/** Omitted entirely when `tenantId` is left to the ambient acting tenant (`billing-api.ts`). */
const scope = (tenantId?: string) => (tenantId === undefined ? {} : { tenantId });

function liveQueryString({ patientId, mine }: LiveVisitQuery): string {
  const search = new URLSearchParams();
  if (patientId !== undefined) search.set('patientId', patientId);
  if (mine !== undefined) search.set('mine', String(mine));
  const query = search.toString();
  return query ? `?${query}` : '';
}

// Reads.

export const visitQuery = (id: string, tenantId?: string) =>
  queryOptions({
    queryKey: visitKeys.detail(tenantId ?? actingTenantId(), id),
    queryFn: () => apiFetch(`/visits/${id}`, visitSchema, scope(tenantId)),
  });

/** `GET /visits/live`: `mine` is the header pill's filter (W18), `patientId` the record's. */
export const liveVisitsQuery = (filter: LiveVisitQuery, tenantId?: string) =>
  queryOptions({
    queryKey: visitKeys.live(tenantId ?? actingTenantId(), filter),
    queryFn: () =>
      apiFetch(
        `/visits/live${liveQueryString(filter)}`,
        z.array(liveVisitRefSchema),
        scope(tenantId),
      ),
  });

/** The start popover's defaults (V3). Always refetched when the popover opens: the room it
 * suggests must still be free. */
export const startDefaultsQuery = (tenantId?: string) =>
  queryOptions({
    queryKey: visitKeys.startDefaults(tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/visits/start-defaults', startDefaultsSchema, scope(tenantId)),
    staleTime: 0,
  });

export const chartQuery = (patientId: string, tenantId?: string) =>
  queryOptions({
    queryKey: clinicalKeys.chart(tenantId ?? actingTenantId(), patientId),
    queryFn: () =>
      apiFetch(`/clinical/patients/${patientId}/chart`, patientChartSchema, scope(tenantId)),
  });

export const toothHistoryQuery = (patientId: string, toothCode: ToothCode, tenantId?: string) =>
  queryOptions({
    queryKey: clinicalKeys.toothHistory(tenantId ?? actingTenantId(), patientId, toothCode),
    queryFn: () =>
      apiFetch(
        `/clinical/patients/${patientId}/teeth/${toothCode}/history`,
        toothHistorySchema,
        scope(tenantId),
      ),
  });

export const lastVisitQuery = (patientId: string, tenantId?: string) =>
  queryOptions({
    queryKey: clinicalKeys.lastVisit(tenantId ?? actingTenantId(), patientId),
    queryFn: () =>
      apiFetch(`/clinical/patients/${patientId}/last-visit`, lastVisitSchema, scope(tenantId)),
  });

export const clinicalSummaryQuery = (patientId: string, tenantId?: string) =>
  queryOptions({
    queryKey: clinicalKeys.summary(tenantId ?? actingTenantId(), patientId),
    queryFn: () =>
      apiFetch(`/clinical/patients/${patientId}/summary`, clinicalSummarySchema, scope(tenantId)),
  });

// Writes: each answers with the updated visit (`{ visit }`), plus the affected `record` for the
// service and charting routes.

export function startVisit(input: StartVisitInput) {
  return apiFetch('/visits', startVisitResultSchema, { method: 'POST', json: input });
}

function visitCall<TSchema extends z.ZodType>(
  schema: TSchema,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  visitId: string,
  path: string,
  json?: unknown,
) {
  const url = `/visits/${visitId}/${path}`;
  return apiFetch(url, schema, json === undefined ? { method } : { method, json });
}

export const pauseVisit = (visitId: string) =>
  visitCall(visitResultSchema, 'POST', visitId, 'pause');
export const resumeVisit = (visitId: string) =>
  visitCall(visitResultSchema, 'POST', visitId, 'resume');
export const discardVisit = (visitId: string) =>
  visitCall(visitResultSchema, 'POST', visitId, 'discard');
export const completeVisit = (visitId: string) =>
  visitCall(visitResultSchema, 'POST', visitId, 'complete');

export const updateVisitNotes = (visitId: string, input: VisitNotesInput) =>
  visitCall(visitResultSchema, 'PATCH', visitId, 'notes', input);
export const setVisitDiscount = (visitId: string, input: VisitDiscountInput) =>
  visitCall(visitResultSchema, 'PATCH', visitId, 'discount', input);

export const addService = (visitId: string, input: AddServiceInput) =>
  visitCall(serviceResultSchema, 'POST', visitId, 'services', input);
export const updateService = (visitId: string, serviceId: string, patch: UpdateServiceInput) =>
  visitCall(serviceResultSchema, 'PATCH', visitId, `services/${serviceId}`, patch);
export const removeService = (visitId: string, serviceId: string) =>
  visitCall(serviceResultSchema, 'DELETE', visitId, `services/${serviceId}`);

export const recordDiagnosis = (visitId: string, input: RecordDiagnosisInput) =>
  visitCall(diagnosisResultSchema, 'POST', visitId, 'diagnoses', input);
export const resolveDiagnosis = (visitId: string, recordId: string) =>
  visitCall(diagnosisResultSchema, 'POST', visitId, `diagnoses/${recordId}/resolve`);
export const reopenDiagnosis = (visitId: string, recordId: string) =>
  visitCall(diagnosisResultSchema, 'POST', visitId, `diagnoses/${recordId}/reopen`);
export const removeDiagnosis = (visitId: string, recordId: string) =>
  visitCall(diagnosisResultSchema, 'DELETE', visitId, `diagnoses/${recordId}`);

export const planTreatment = (visitId: string, input: PlanTreatmentInput) =>
  visitCall(planResultSchema, 'POST', visitId, 'plans', input);
export const performPlan = (visitId: string, planId: string) =>
  visitCall(planResultSchema, 'POST', visitId, `plans/${planId}/perform`);
export const cancelPlan = (visitId: string, planId: string) =>
  visitCall(planResultSchema, 'POST', visitId, `plans/${planId}/cancel`);
export const removePlan = (visitId: string, planId: string) =>
  visitCall(planResultSchema, 'DELETE', visitId, `plans/${planId}`);

export const setToothPresence = (visitId: string, { position, present }: ToothPresence) =>
  visitCall(toothPresenceResultSchema, 'PUT', visitId, `teeth/${position}`, { present });
