import {
  clinicalSummarySchema,
  diagnosisRecordSchema,
  lastVisitSchema,
  liveVisitRefSchema,
  patientChartSchema,
  startDefaultsSchema,
  startVisitResultSchema,
  toothHistorySchema,
  toothPresenceSchema,
  treatmentPlanSchema,
  visitSchema,
  type AddServiceInput,
  type LiveVisitQuery,
  type PlanTreatmentInput,
  type RecordDiagnosisInput,
  type StartVisitInput,
  type ToothCode,
  type ToothPresence,
  type UpdateServiceInput,
  type Visit,
  type VisitDiscountInput,
  type VisitNotesInput,
} from '@dcm/contracts';
import { mutationOptions, type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { billingKeys } from '@/features/billing/billing-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/**
 * The live visit and the patient's clinical reads (feature 4a, spec §HTTP): `clinical`'s
 * `/visits` and `/clinical/patients` routes.
 *
 * Every mutation that changes a visit answers with the updated `Visit` (`{ visit }`, plus the
 * affected `record` for the charting routes), which replaces the `['visit', id]` cache without a
 * refetch. A change to what is charted also invalidates the patient's chart, tooth histories and
 * treatment summary; a lifecycle change invalidates the live-visit lists (the header pill).
 */
export const visitKeys = {
  detail: (id: string) => ['visit', id] as const,
  allLive: ['visits', 'live'] as const,
  live: (filter: LiveVisitQuery) => [...visitKeys.allLive, filter] as const,
  startDefaults: ['visits', 'start-defaults'] as const,
};

export const clinicalKeys = {
  chart: (patientId: string) => ['clinical', 'chart', patientId] as const,
  toothHistories: (patientId: string) => ['clinical', 'tooth-history', patientId] as const,
  toothHistory: (patientId: string, toothCode: ToothCode) =>
    [...clinicalKeys.toothHistories(patientId), toothCode] as const,
  summary: (patientId: string) => ['clinical', 'summary', patientId] as const,
  lastVisit: (patientId: string) => ['clinical', 'last-visit', patientId] as const,
};

const visitResultSchema = z.object({ visit: visitSchema });
const diagnosisResultSchema = z.object({ visit: visitSchema, record: diagnosisRecordSchema });
const planResultSchema = z.object({ visit: visitSchema, record: treatmentPlanSchema });
const toothResultSchema = z.object({ visit: visitSchema, record: toothPresenceSchema });

function liveQueryString({ patientId, mine }: LiveVisitQuery): string {
  const search = new URLSearchParams();
  if (patientId !== undefined) search.set('patientId', patientId);
  if (mine !== undefined) search.set('mine', String(mine));
  const query = search.toString();
  return query ? `?${query}` : '';
}

// Reads.

export const visitQuery = (id: string) =>
  queryOptions({
    queryKey: visitKeys.detail(id),
    queryFn: () => apiFetch(`/visits/${id}`, visitSchema),
  });

/** `GET /visits/live`: `mine` is the header pill's filter (W18), `patientId` the record's. */
export const liveVisitsQuery = (filter: LiveVisitQuery) =>
  queryOptions({
    queryKey: visitKeys.live(filter),
    queryFn: () => apiFetch(`/visits/live${liveQueryString(filter)}`, z.array(liveVisitRefSchema)),
  });

/** The start popover's defaults (V3). Always refetched when the popover opens: the room it
 * suggests must still be free. */
export const startDefaultsQuery = () =>
  queryOptions({
    queryKey: visitKeys.startDefaults,
    queryFn: () => apiFetch('/visits/start-defaults', startDefaultsSchema),
    staleTime: 0,
  });

export const chartQuery = (patientId: string) =>
  queryOptions({
    queryKey: clinicalKeys.chart(patientId),
    queryFn: () => apiFetch(`/clinical/patients/${patientId}/chart`, patientChartSchema),
  });

export const toothHistoryQuery = (patientId: string, toothCode: ToothCode) =>
  queryOptions({
    queryKey: clinicalKeys.toothHistory(patientId, toothCode),
    queryFn: () =>
      apiFetch(`/clinical/patients/${patientId}/teeth/${toothCode}/history`, toothHistorySchema),
  });

export const lastVisitQuery = (patientId: string) =>
  queryOptions({
    queryKey: clinicalKeys.lastVisit(patientId),
    queryFn: () => apiFetch(`/clinical/patients/${patientId}/last-visit`, lastVisitSchema),
  });

export const clinicalSummaryQuery = (patientId: string) =>
  queryOptions({
    queryKey: clinicalKeys.summary(patientId),
    queryFn: () => apiFetch(`/clinical/patients/${patientId}/summary`, clinicalSummarySchema),
  });

// Writes.

export function startVisit(input: StartVisitInput) {
  return apiFetch('/visits', startVisitResultSchema, { method: 'POST', json: input });
}

const visitPath = (visitId: string, rest: string) => `/visits/${visitId}/${rest}`;

function visitCall<TSchema extends z.ZodType>(
  schema: TSchema,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  json?: unknown,
) {
  return apiFetch(path, schema, json === undefined ? { method } : { method, json });
}

export const pauseVisit = (visitId: string) =>
  visitCall(visitResultSchema, 'POST', visitPath(visitId, 'pause'));
export const resumeVisit = (visitId: string) =>
  visitCall(visitResultSchema, 'POST', visitPath(visitId, 'resume'));
export const discardVisit = (visitId: string) =>
  visitCall(visitResultSchema, 'POST', visitPath(visitId, 'discard'));
export const completeVisit = (visitId: string) =>
  visitCall(visitResultSchema, 'POST', visitPath(visitId, 'complete'));

export const updateVisitNotes = (visitId: string, input: VisitNotesInput) =>
  visitCall(visitResultSchema, 'PATCH', visitPath(visitId, 'notes'), input);
export const setVisitDiscount = (visitId: string, input: VisitDiscountInput) =>
  visitCall(visitResultSchema, 'PATCH', visitPath(visitId, 'discount'), input);

export const addService = (visitId: string, input: AddServiceInput) =>
  visitCall(visitResultSchema, 'POST', visitPath(visitId, 'services'), input);
export const updateService = (visitId: string, serviceId: string, patch: UpdateServiceInput) =>
  visitCall(visitResultSchema, 'PATCH', visitPath(visitId, `services/${serviceId}`), patch);
export const removeService = (visitId: string, serviceId: string) =>
  visitCall(visitResultSchema, 'DELETE', visitPath(visitId, `services/${serviceId}`));

export const recordDiagnosis = (visitId: string, input: RecordDiagnosisInput) =>
  visitCall(diagnosisResultSchema, 'POST', visitPath(visitId, 'diagnoses'), input);
export const resolveDiagnosis = (visitId: string, recordId: string) =>
  visitCall(diagnosisResultSchema, 'POST', visitPath(visitId, `diagnoses/${recordId}/resolve`));
export const reopenDiagnosis = (visitId: string, recordId: string) =>
  visitCall(diagnosisResultSchema, 'POST', visitPath(visitId, `diagnoses/${recordId}/reopen`));
export const removeDiagnosis = (visitId: string, recordId: string) =>
  visitCall(diagnosisResultSchema, 'DELETE', visitPath(visitId, `diagnoses/${recordId}`));

export const planTreatment = (visitId: string, input: PlanTreatmentInput) =>
  visitCall(planResultSchema, 'POST', visitPath(visitId, 'plans'), input);
export const performPlan = (visitId: string, planId: string) =>
  visitCall(planResultSchema, 'POST', visitPath(visitId, `plans/${planId}/perform`));
export const cancelPlan = (visitId: string, planId: string) =>
  visitCall(planResultSchema, 'POST', visitPath(visitId, `plans/${planId}/cancel`));
export const removePlan = (visitId: string, planId: string) =>
  visitCall(planResultSchema, 'DELETE', visitPath(visitId, `plans/${planId}`));

export const setToothPresence = (visitId: string, { position, present }: ToothPresence) =>
  visitCall(toothResultSchema, 'PUT', visitPath(visitId, `teeth/${position}`), { present });

// Cache effects.

function writeVisit(queryClient: QueryClient, visit: Visit): void {
  queryClient.setQueryData(visitKeys.detail(visit.id), visit);
}

function invalidate(queryClient: QueryClient, keys: readonly (readonly unknown[])[]) {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
    () => undefined,
  );
}

/** What the chart card, tooth history and Overview's treatment summary derive from. */
const chartingKeys = (patientId: string) => [
  clinicalKeys.chart(patientId),
  clinicalKeys.toothHistories(patientId),
  clinicalKeys.summary(patientId),
];

/** A visit started or ended: the live-visit lists and the chart's `liveVisitId` are stale. */
function afterLiveChange(queryClient: QueryClient, visit: Visit) {
  writeVisit(queryClient, visit);
  return invalidate(queryClient, [visitKeys.allLive, clinicalKeys.chart(visit.patientId)]);
}

/** `POST /visits`: a new or resumed visit; either way the patient now has a live visit. */
export function startVisitMutation(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: startVisit,
    onSuccess: ({ visit }) => afterLiveChange(queryClient, visit),
  });
}

/**
 * The workspace's mutations for one visit, for `useMutation`. Each writes the returned visit
 * into its cache; the rest of each `onSuccess` is what that change makes stale elsewhere.
 */
export function visitMutations(queryClient: QueryClient, visitId: string) {
  const visitOnly = ({ visit }: { visit: Visit }) => {
    writeVisit(queryClient, visit);
  };
  const charting = ({ visit }: { visit: Visit }) => {
    writeVisit(queryClient, visit);
    return invalidate(queryClient, chartingKeys(visit.patientId));
  };
  /** Pause and resume change only what the live-visit pill shows. */
  const liveStatus = ({ visit }: { visit: Visit }) => {
    writeVisit(queryClient, visit);
    return invalidate(queryClient, [visitKeys.allLive]);
  };

  return {
    pause: mutationOptions({ mutationFn: () => pauseVisit(visitId), onSuccess: liveStatus }),
    resume: mutationOptions({ mutationFn: () => resumeVisit(visitId), onSuccess: liveStatus }),
    discard: mutationOptions({
      mutationFn: () => discardVisit(visitId),
      onSuccess: ({ visit }) => afterLiveChange(queryClient, visit),
    }),
    /** The charge is posted in the same transaction (W2), so the balances are stale too. */
    complete: mutationOptions({
      mutationFn: () => completeVisit(visitId),
      onSuccess: ({ visit }) => {
        writeVisit(queryClient, visit);
        return invalidate(queryClient, [
          visitKeys.allLive,
          ...chartingKeys(visit.patientId),
          clinicalKeys.lastVisit(visit.patientId),
          billingKeys.all(actingTenantId()),
        ]);
      },
    }),
    updateNotes: mutationOptions({
      mutationFn: (input: VisitNotesInput) => updateVisitNotes(visitId, input),
      onSuccess: visitOnly,
    }),
    setDiscount: mutationOptions({
      mutationFn: (input: VisitDiscountInput) => setVisitDiscount(visitId, input),
      onSuccess: visitOnly,
    }),
    addService: mutationOptions({
      mutationFn: (input: AddServiceInput) => addService(visitId, input),
      onSuccess: charting,
    }),
    /** A price edit changes only the visit's money, never the chart. */
    updateService: mutationOptions({
      mutationFn: ({ serviceId, patch }: { serviceId: string; patch: UpdateServiceInput }) =>
        updateService(visitId, serviceId, patch),
      onSuccess: visitOnly,
    }),
    /** Removing a performed plan's service also reopens the plan (the Undo of Perform). */
    removeService: mutationOptions({
      mutationFn: (serviceId: string) => removeService(visitId, serviceId),
      onSuccess: charting,
    }),
    recordDiagnosis: mutationOptions({
      mutationFn: (input: RecordDiagnosisInput) => recordDiagnosis(visitId, input),
      onSuccess: charting,
    }),
    resolveDiagnosis: mutationOptions({
      mutationFn: (recordId: string) => resolveDiagnosis(visitId, recordId),
      onSuccess: charting,
    }),
    reopenDiagnosis: mutationOptions({
      mutationFn: (recordId: string) => reopenDiagnosis(visitId, recordId),
      onSuccess: charting,
    }),
    removeDiagnosis: mutationOptions({
      mutationFn: (recordId: string) => removeDiagnosis(visitId, recordId),
      onSuccess: charting,
    }),
    planTreatment: mutationOptions({
      mutationFn: (input: PlanTreatmentInput) => planTreatment(visitId, input),
      onSuccess: charting,
    }),
    performPlan: mutationOptions({
      mutationFn: (planId: string) => performPlan(visitId, planId),
      onSuccess: charting,
    }),
    cancelPlan: mutationOptions({
      mutationFn: (planId: string) => cancelPlan(visitId, planId),
      onSuccess: charting,
    }),
    removePlan: mutationOptions({
      mutationFn: (planId: string) => removePlan(visitId, planId),
      onSuccess: charting,
    }),
    setToothPresence: mutationOptions({
      mutationFn: (input: ToothPresence) => setToothPresence(visitId, input),
      onSuccess: charting,
    }),
  };
}
