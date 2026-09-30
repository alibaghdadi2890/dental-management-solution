import type {
  AddServiceInput,
  PlanTreatmentInput,
  RecordDiagnosisInput,
  ToothPresence,
  UpdateServiceInput,
  Visit,
  VisitDiscountInput,
  VisitNotesInput,
} from '@dcm/contracts';
import { mutationOptions, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { invalidatePatientData } from '@/features/patients/patients-api';
import { actingTenantId, useActingTenantId } from '@/features/platform/acting-tenant';
import {
  addService,
  cancelPlan,
  clinicalKeys,
  completeVisit,
  discardVisit,
  pauseVisit,
  performPlan,
  planTreatment,
  recordDiagnosis,
  removeDiagnosis,
  removePlan,
  removeService,
  reopenDiagnosis,
  resolveDiagnosis,
  resumeVisit,
  setToothPresence,
  setVisitDiscount,
  startVisit,
  updateService,
  updateVisitNotes,
  visitKeys,
} from './visits-api';

type Tenant = string | null;
type Keys = readonly (readonly unknown[])[];

/**
 * Writes a mutation's returned visit into its cache without a refetch (spec §HTTP). A refetch
 * already in flight may have read the visit before this change, so it is cancelled first, or it
 * would land afterwards and put the old visit back. While another mutation of the same visit is
 * still in flight, this answer may already be outdated, so the visit is refetched instead (the
 * last mutation to finish writes its own answer, cancelling that refetch).
 */
function writeVisit(queryClient: QueryClient, tenantId: Tenant, visit: Visit): Promise<void> {
  const queryKey = visitKeys.detail(tenantId, visit.id);
  return queryClient.cancelQueries({ queryKey }).then(() => {
    if (queryClient.isMutating({ mutationKey: queryKey }) <= 1) {
      queryClient.setQueryData(queryKey, visit);
    } else {
      void queryClient.invalidateQueries({ queryKey });
    }
  });
}

function invalidate(queryClient: QueryClient, keys: Keys): Promise<void> {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
    () => undefined,
  );
}

/** What the chart card, tooth history and the Overview's treatment summary derive from. */
const chartingKeys = (tenantId: Tenant, patientId: string) => [
  clinicalKeys.chart(tenantId, patientId),
  clinicalKeys.toothHistories(tenantId, patientId),
  clinicalKeys.summary(tenantId, patientId),
];

/** `POST /visits`: a new or resumed visit; either way the patient now has a live visit (the
 * live-visit lists and the chart's `liveVisitId`). */
export function startVisitMutation(queryClient: QueryClient, tenantId: Tenant = actingTenantId()) {
  return mutationOptions({
    mutationFn: startVisit,
    onSuccess: async ({ visit }) => {
      await writeVisit(queryClient, tenantId, visit);
      await invalidate(queryClient, [
        visitKeys.allLive(tenantId),
        clinicalKeys.chart(tenantId, visit.patientId),
      ]);
    },
  });
}

/**
 * The workspace's mutations for one visit, for `useMutation` (`useVisitMutations` memoises
 * them). Each shares the visit's mutation key and cancels its refetch as it starts
 * (`writeVisit`); each `onSuccess` writes the returned visit, then invalidates what the change
 * makes stale elsewhere.
 */
export function visitMutations(
  queryClient: QueryClient,
  visitId: string,
  tenantId: Tenant = actingTenantId(),
) {
  const mutationKey = visitKeys.detail(tenantId, visitId);
  const base = {
    mutationKey,
    onMutate: () => queryClient.cancelQueries({ queryKey: mutationKey }),
  };
  const then =
    (stale: (visit: Visit) => Keys) =>
    async ({ visit }: { visit: Visit }) => {
      await writeVisit(queryClient, tenantId, visit);
      await invalidate(queryClient, stale(visit));
    };
  const visitOnly = then(() => []);
  const charting = then((visit) => chartingKeys(tenantId, visit.patientId));
  /** Pause and resume change only what the live-visit pill shows. */
  const liveStatus = then(() => [visitKeys.allLive(tenantId)]);

  return {
    pause: mutationOptions({
      ...base,
      mutationFn: () => pauseVisit(visitId),
      onSuccess: liveStatus,
    }),
    resume: mutationOptions({
      ...base,
      mutationFn: () => resumeVisit(visitId),
      onSuccess: liveStatus,
    }),
    /** A discarded visit is gone (`GET` answers 404), so it is never refetched: the returned
     * visit stays cached with its `discarded` status, which the open workspace reads to leave
     * for the patient record. Dropping the entry instead would make that workspace refetch it and
     * flash "not found" first. */
    discard: mutationOptions({
      ...base,
      mutationFn: () => discardVisit(visitId),
      onSuccess: then((visit) => [
        visitKeys.allLive(tenantId),
        clinicalKeys.chart(tenantId, visit.patientId),
      ]),
    }),
    /** The charge is posted in the same transaction (W2): the balances are stale too. */
    complete: mutationOptions({
      ...base,
      mutationFn: () => completeVisit(visitId),
      onSuccess: async ({ visit }) => {
        await writeVisit(queryClient, tenantId, visit);
        await Promise.all([
          invalidate(queryClient, [
            visitKeys.allLive(tenantId),
            ...chartingKeys(tenantId, visit.patientId),
            clinicalKeys.lastVisit(tenantId, visit.patientId),
          ]),
          invalidatePatientData(queryClient, tenantId),
        ]);
      },
    }),
    updateNotes: mutationOptions({
      ...base,
      mutationFn: (input: VisitNotesInput) => updateVisitNotes(visitId, input),
      onSuccess: visitOnly,
    }),
    setDiscount: mutationOptions({
      ...base,
      mutationFn: (input: VisitDiscountInput) => setVisitDiscount(visitId, input),
      onSuccess: visitOnly,
    }),
    /** A new service can mark its tooth treated today. */
    addService: mutationOptions({
      ...base,
      mutationFn: (input: AddServiceInput) => addService(visitId, input),
      onSuccess: charting,
    }),
    /** A price edit changes only the visit's money, never the chart. */
    updateService: mutationOptions({
      ...base,
      mutationFn: ({ serviceId, patch }: { serviceId: string; patch: UpdateServiceInput }) =>
        updateService(visitId, serviceId, patch),
      onSuccess: visitOnly,
    }),
    /** Removing a performed plan's service also reopens the plan (the Undo of Perform). */
    removeService: mutationOptions({
      ...base,
      mutationFn: (serviceId: string) => removeService(visitId, serviceId),
      onSuccess: charting,
    }),
    recordDiagnosis: mutationOptions({
      ...base,
      mutationFn: (input: RecordDiagnosisInput) => recordDiagnosis(visitId, input),
      onSuccess: charting,
    }),
    resolveDiagnosis: mutationOptions({
      ...base,
      mutationFn: (recordId: string) => resolveDiagnosis(visitId, recordId),
      onSuccess: charting,
    }),
    reopenDiagnosis: mutationOptions({
      ...base,
      mutationFn: (recordId: string) => reopenDiagnosis(visitId, recordId),
      onSuccess: charting,
    }),
    removeDiagnosis: mutationOptions({
      ...base,
      mutationFn: (recordId: string) => removeDiagnosis(visitId, recordId),
      onSuccess: charting,
    }),
    planTreatment: mutationOptions({
      ...base,
      mutationFn: (input: PlanTreatmentInput) => planTreatment(visitId, input),
      onSuccess: charting,
    }),
    performPlan: mutationOptions({
      ...base,
      mutationFn: (planId: string) => performPlan(visitId, planId),
      onSuccess: charting,
    }),
    cancelPlan: mutationOptions({
      ...base,
      mutationFn: (planId: string) => cancelPlan(visitId, planId),
      onSuccess: charting,
    }),
    removePlan: mutationOptions({
      ...base,
      mutationFn: (planId: string) => removePlan(visitId, planId),
      onSuccess: charting,
    }),
    setToothPresence: mutationOptions({
      ...base,
      mutationFn: (input: ToothPresence) => setToothPresence(visitId, input),
      onSuccess: charting,
    }),
  };
}

/** `visitMutations` for the acting tenant, stable across renders. */
export function useVisitMutations(visitId: string) {
  const queryClient = useQueryClient();
  const tenantId = useActingTenantId();
  return useMemo(
    () => visitMutations(queryClient, visitId, tenantId),
    [queryClient, visitId, tenantId],
  );
}
