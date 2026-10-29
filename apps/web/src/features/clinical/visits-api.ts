import {
  diagnosisResultSchema,
  fileCitationSchema,
  lastVisitSchema,
  liveVisitRefSchema,
  patientChartSchema,
  patientHistoryConfirmationSchema,
  planResultSchema,
  presenceResultSchema,
  serviceResultSchema,
  startDefaultsSchema,
  startOptionsSchema,
  startVisitResultSchema,
  toothHistorySchema,
  visitResultSchema,
  visitStatSchema,
  visitSchema,
  type AddServiceInput,
  type LiveVisitQuery,
  type PlanPriorityInput,
  type PlanTreatmentInput,
  type RecordSessionInput,
  type RecordDiagnosisInput,
  type SeenOnInput,
  type SetPresenceInVisitInput,
  type StartVisitRequest,
  type ToothCode,
  type UpdateServiceInput,
  type VisitComplaintInput,
  type VisitDiscountInput,
  type VisitNotesInput,
  type VisitReasonInput,
  type VisitStepInput,
  type VisitType,
  type VisitViewInput,
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
  lastVisit: (tenantId: string | null, patientId: string) =>
    [...clinicalKeys.all(tenantId), 'last-visit', patientId] as const,
  historyConfirmation: (tenantId: string | null, patientId: string) =>
    [...clinicalKeys.all(tenantId), 'history-confirmation', patientId] as const,
  fileCitations: (tenantId: string | null, patientId: string) =>
    [...clinicalKeys.all(tenantId), 'file-citations', patientId] as const,
  visitStats: (tenantId: string | null, patientIds: readonly string[]) =>
    [...clinicalKeys.all(tenantId), 'visit-stats', [...patientIds].sort()] as const,
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

/** The patient's last completed visit of one type: the Hygiene step's "Last hygiene visit". */
export const lastVisitOfTypeQuery = (patientId: string, type: VisitType, tenantId?: string) =>
  queryOptions({
    queryKey: [...clinicalKeys.lastVisit(tenantId ?? actingTenantId(), patientId), type] as const,
    queryFn: () =>
      apiFetch(
        `/clinical/patients/${patientId}/last-visit?type=${type}`,
        lastVisitSchema,
        scope(tenantId),
      ),
  });

/** The last time a dentist confirmed the patient's medical history in a visit (ADR-0046). */
export const historyConfirmationQuery = (patientId: string, tenantId?: string) =>
  queryOptions({
    queryKey: clinicalKeys.historyConfirmation(tenantId ?? actingTenantId(), patientId),
    queryFn: () =>
      apiFetch(
        `/clinical/patients/${patientId}/history-confirmation`,
        patientHistoryConfirmationSchema,
        scope(tenantId),
      ),
  });

/** Per file, the diagnoses seen on it (ADR-0049): the image viewer's list. */
export const fileCitationsQuery = (patientId: string, tenantId?: string) =>
  queryOptions({
    queryKey: clinicalKeys.fileCitations(tenantId ?? actingTenantId(), patientId),
    queryFn: () =>
      apiFetch(
        `/clinical/patients/${patientId}/file-citations`,
        z.array(fileCitationSchema),
        scope(tenantId),
      ),
  });

/** The patients list's Last visit and Visits columns for the visible page (4b, D18). */
export const visitStatsQuery = (patientIds: readonly string[], tenantId?: string) =>
  queryOptions({
    queryKey: clinicalKeys.visitStats(tenantId ?? actingTenantId(), patientIds),
    queryFn: () =>
      apiFetch(
        `/clinical/patients/visit-stats?patientIds=${patientIds.join(',')}`,
        z.array(visitStatSchema),
        scope(tenantId),
      ),
    enabled: patientIds.length > 0,
  });

// Writes: each answers with the updated visit (`{ visit }`), plus the affected `record` for the
// service and charting routes. Each takes the tenant its cache keys are scoped by
// (`visit-mutations.ts`), so the request and the cache always name the same clinic.

/** The Start visit popover's suggestion and plan rows for a patient; refetched each opening. */
export const startOptionsQuery = (patientId: string, tenantId?: string) =>
  queryOptions({
    queryKey: [
      ...visitKeys.startDefaults(tenantId ?? actingTenantId()),
      'options',
      patientId,
    ] as const,
    queryFn: () =>
      apiFetch(`/visits/start-options?patientId=${patientId}`, startOptionsSchema, scope(tenantId)),
    staleTime: 0,
  });

export function startVisit(input: StartVisitRequest, tenantId?: string) {
  return apiFetch('/visits', startVisitResultSchema, {
    method: 'POST',
    json: input,
    ...scope(tenantId),
  });
}

function visitCall<TSchema extends z.ZodType>(
  schema: TSchema,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  visitId: string,
  path: string,
  { json, tenantId }: { json?: unknown; tenantId?: string | undefined } = {},
) {
  const url = `/visits/${visitId}/${path}`;
  return apiFetch(url, schema, {
    method,
    ...(json === undefined ? {} : { json }),
    ...scope(tenantId),
  });
}

export const pauseVisit = (visitId: string, tenantId?: string) =>
  visitCall(visitResultSchema, 'POST', visitId, 'pause', { tenantId });
export const resumeVisit = (visitId: string, tenantId?: string) =>
  visitCall(visitResultSchema, 'POST', visitId, 'resume', { tenantId });
export const discardVisit = (visitId: string, tenantId?: string) =>
  visitCall(visitResultSchema, 'POST', visitId, 'discard', { tenantId });
export const completeVisit = (visitId: string, tenantId?: string) =>
  visitCall(visitResultSchema, 'POST', visitId, 'complete', { tenantId });

export const updateVisitNotes = (visitId: string, input: VisitNotesInput, tenantId?: string) =>
  visitCall(visitResultSchema, 'PATCH', visitId, 'notes', { json: input, tenantId });
export const setVisitDiscount = (visitId: string, input: VisitDiscountInput, tenantId?: string) =>
  visitCall(visitResultSchema, 'PATCH', visitId, 'discount', { json: input, tenantId });

// The flow (feature 10): where the visit is, why the patient came, what was confirmed.
export const setVisitStep = (visitId: string, input: VisitStepInput, tenantId?: string) =>
  visitCall(visitResultSchema, 'PATCH', visitId, 'step', { json: input, tenantId });
export const setVisitView = (visitId: string, input: VisitViewInput, tenantId?: string) =>
  visitCall(visitResultSchema, 'PATCH', visitId, 'view', { json: input, tenantId });
export const setVisitReason = (visitId: string, input: VisitReasonInput, tenantId?: string) =>
  visitCall(visitResultSchema, 'PATCH', visitId, 'reason', { json: input, tenantId });
export const setVisitComplaint = (visitId: string, input: VisitComplaintInput, tenantId?: string) =>
  visitCall(visitResultSchema, 'PATCH', visitId, 'complaint', { json: input, tenantId });
export const confirmHistory = (visitId: string, tenantId?: string) =>
  visitCall(visitResultSchema, 'PUT', visitId, 'history-confirmation', { tenantId });
export const unconfirmHistory = (visitId: string, tenantId?: string) =>
  visitCall(visitResultSchema, 'DELETE', visitId, 'history-confirmation', { tenantId });
/** Today's work: a planned treatment ticked onto the visit's list for today, or off it. */
export const addWorkItem = (visitId: string, planId: string, tenantId?: string) =>
  visitCall(visitResultSchema, 'PUT', visitId, `worklist/${planId}`, { tenantId });
export const removeWorkItem = (visitId: string, planId: string, tenantId?: string) =>
  visitCall(visitResultSchema, 'DELETE', visitId, `worklist/${planId}`, { tenantId });

export const addService = (visitId: string, input: AddServiceInput, tenantId?: string) =>
  visitCall(serviceResultSchema, 'POST', visitId, 'services', { json: input, tenantId });
export const updateService = (
  visitId: string,
  serviceId: string,
  patch: UpdateServiceInput,
  tenantId?: string,
) =>
  visitCall(serviceResultSchema, 'PATCH', visitId, `services/${serviceId}`, {
    json: patch,
    tenantId,
  });
export const removeService = (visitId: string, serviceId: string, tenantId?: string) =>
  visitCall(serviceResultSchema, 'DELETE', visitId, `services/${serviceId}`, { tenantId });

/** Not finished: the service becomes work in progress; `record` is its plan. */
export const markServiceUnfinished = (visitId: string, serviceId: string, tenantId?: string) =>
  visitCall(planResultSchema, 'POST', visitId, `services/${serviceId}/unfinished`, { tenantId });

export const recordDiagnosis = (visitId: string, input: RecordDiagnosisInput, tenantId?: string) =>
  visitCall(diagnosisResultSchema, 'POST', visitId, 'diagnoses', { json: input, tenantId });
export const resolveDiagnosis = (visitId: string, recordId: string, tenantId?: string) =>
  visitCall(diagnosisResultSchema, 'POST', visitId, `diagnoses/${recordId}/resolve`, {
    tenantId,
  });
export const reopenDiagnosis = (visitId: string, recordId: string, tenantId?: string) =>
  visitCall(diagnosisResultSchema, 'POST', visitId, `diagnoses/${recordId}/reopen`, {
    tenantId,
  });
export const removeDiagnosis = (visitId: string, recordId: string, tenantId?: string) =>
  visitCall(diagnosisResultSchema, 'DELETE', visitId, `diagnoses/${recordId}`, { tenantId });
export const setDiagnosisSeenOn = (
  visitId: string,
  recordId: string,
  input: SeenOnInput,
  tenantId?: string,
) =>
  visitCall(diagnosisResultSchema, 'PATCH', visitId, `diagnoses/${recordId}/seen-on`, {
    json: input,
    tenantId,
  });

export const planTreatment = (visitId: string, input: PlanTreatmentInput, tenantId?: string) =>
  visitCall(planResultSchema, 'POST', visitId, 'plans', { json: input, tenantId });
export const setPlanPriority = (
  visitId: string,
  planId: string,
  input: PlanPriorityInput,
  tenantId?: string,
) =>
  visitCall(planResultSchema, 'PATCH', visitId, `plans/${planId}/priority`, {
    json: input,
    tenantId,
  });
export const performPlan = (visitId: string, planId: string, tenantId?: string) =>
  visitCall(planResultSchema, 'POST', visitId, `plans/${planId}/perform`, { tenantId });
/** The Undo of a Complete that another visit charged (ADR-0064): the work is in progress again. */
export const reopenPlan = (visitId: string, planId: string, tenantId?: string) =>
  visitCall(planResultSchema, 'POST', visitId, `plans/${planId}/reopen`, { tenantId });
export const recordSession = (
  visitId: string,
  planId: string,
  input: RecordSessionInput,
  tenantId?: string,
) =>
  visitCall(planResultSchema, 'PUT', visitId, `plans/${planId}/session`, { json: input, tenantId });
export const removeSession = (visitId: string, planId: string, tenantId?: string) =>
  visitCall(planResultSchema, 'DELETE', visitId, `plans/${planId}/session`, { tenantId });
export const cancelPlan = (visitId: string, planId: string, tenantId?: string) =>
  visitCall(planResultSchema, 'POST', visitId, `plans/${planId}/cancel`, { tenantId });
export const removePlan = (visitId: string, planId: string, tenantId?: string) =>
  visitCall(planResultSchema, 'DELETE', visitId, `plans/${planId}`, { tenantId });
/** Tooth presence in a visit (feature 7): `record` is null when the tooth already had it. */
export const setPresence = (
  visitId: string,
  toothCode: ToothCode,
  input: SetPresenceInVisitInput,
  tenantId?: string,
) =>
  visitCall(presenceResultSchema, 'PUT', visitId, `teeth/${toothCode}/presence`, {
    json: input,
    tenantId,
  });
export const removePresence = (visitId: string, presenceId: string, tenantId?: string) =>
  visitCall(presenceResultSchema, 'DELETE', visitId, `presence/${presenceId}`, { tenantId });
