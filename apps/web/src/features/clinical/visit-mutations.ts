import { visitListKeys } from './visits-list/visits-list-api';
import type {
  AddServiceInput,
  PlanTreatmentInput,
  RecordDiagnosisInput,
  StartVisitInput,
  ToothPresence,
  UpdateServiceInput,
  Visit,
  VisitDiscountInput,
  VisitNotesInput,
} from '@dcm/contracts';
import { hashKey, mutationOptions, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
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

/** Per client, the visits whose refetch a newer write may have cancelled (see `writeVisit`). */
const refetchAfterWrite = new WeakMap<QueryClient, Set<string>>();

function pendingRefetches(queryClient: QueryClient): Set<string> {
  let pending = refetchAfterWrite.get(queryClient);
  if (!pending) {
    pending = new Set();
    refetchAfterWrite.set(queryClient, pending);
  }
  return pending;
}

/** A completed or discarded visit never changes again. */
const isTerminal = (visit: Visit | undefined): boolean =>
  visit?.status === 'completed' || visit?.status === 'discarded';

const cachedIsTerminal = (queryClient: QueryClient, queryKey: readonly unknown[]): boolean =>
  isTerminal(queryClient.getQueryData<Visit>(queryKey));

/**
 * Refetches the visit instead of trusting the cache: after a failed write (the server may have
 * moved on), and after a write answered while another write of the same visit was in flight.
 * In the second case the refetch may be cancelled by the other write's own `writeVisit`, so the
 * visit is marked to be refetched once more after the burst's last write. A visit cached as
 * completed or discarded is final and is never refetched (a discarded one answers 404).
 */
function refetchVisit(queryClient: QueryClient, queryKey: readonly unknown[]): Promise<void> {
  if (cachedIsTerminal(queryClient, queryKey)) return Promise.resolve();
  if (queryClient.isMutating({ mutationKey: queryKey }) > 1) {
    pendingRefetches(queryClient).add(hashKey(queryKey));
  }
  return queryClient.invalidateQueries({ queryKey });
}

/**
 * Writes a mutation's returned visit into its cache without a refetch (spec §HTTP). A refetch
 * already in flight may have read the visit before this change, so it is cancelled first, or it
 * would land afterwards and put the old visit back. While another mutation of the same visit is
 * still in flight, this answer may already be outdated, so the visit is refetched instead. The
 * last mutation of such a burst writes its own answer (cancelling that refetch), then refetches
 * once more: the server may have applied the burst in another order than it answered.
 *
 * A completed or discarded visit is the last word: it is always written, even mid-burst, and no
 * answer arriving after it replaces it.
 */
function writeVisit(queryClient: QueryClient, tenantId: Tenant, visit: Visit): Promise<void> {
  const queryKey = visitKeys.detail(tenantId, visit.id);
  return queryClient.cancelQueries({ queryKey }).then(() => {
    if (isTerminal(visit)) {
      pendingRefetches(queryClient).delete(hashKey(queryKey));
      queryClient.setQueryData(queryKey, visit);
      return;
    }
    if (cachedIsTerminal(queryClient, queryKey)) return;
    if (queryClient.isMutating({ mutationKey: queryKey }) > 1) {
      void refetchVisit(queryClient, queryKey);
      return;
    }
    queryClient.setQueryData(queryKey, visit);
    if (pendingRefetches(queryClient).delete(hashKey(queryKey))) {
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
    mutationFn: (input: StartVisitInput) => startVisit(input, tenantId ?? undefined),
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
  /** The requests go to the tenant the keys are scoped by. */
  const tenant = tenantId ?? undefined;
  const base = {
    mutationKey,
    onMutate: () => queryClient.cancelQueries({ queryKey: mutationKey }),
    onError: () => refetchVisit(queryClient, mutationKey),
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
      mutationFn: () => pauseVisit(visitId, tenant),
      onSuccess: liveStatus,
    }),
    resume: mutationOptions({
      ...base,
      mutationFn: () => resumeVisit(visitId, tenant),
      onSuccess: liveStatus,
    }),
    /** A discarded visit is gone (`GET` answers 404), so it is never refetched: the returned
     * visit stays cached with its `discarded` status, which the open workspace reads to leave
     * for the patient record. Dropping the entry instead would make that workspace refetch it and
     * flash "not found" first. */
    discard: mutationOptions({
      ...base,
      mutationFn: () => discardVisit(visitId, tenant),
      onSuccess: then((visit) => [
        visitKeys.allLive(tenantId),
        clinicalKeys.chart(tenantId, visit.patientId),
      ]),
    }),
    /** The charge is posted in the same transaction (W2): the balances are stale too. */
    complete: mutationOptions({
      ...base,
      mutationFn: () => completeVisit(visitId, tenant),
      onSuccess: async ({ visit }) => {
        await writeVisit(queryClient, tenantId, visit);
        await Promise.all([
          invalidate(queryClient, [
            visitKeys.allLive(tenantId),
            // The visits lists, and with them the header's checkout queue.
            visitListKeys.lists(tenantId),
            ...chartingKeys(tenantId, visit.patientId),
            clinicalKeys.lastVisit(tenantId, visit.patientId),
          ]),
          invalidatePatientData(queryClient, tenantId),
        ]);
      },
    }),
    updateNotes: mutationOptions({
      ...base,
      mutationFn: (input: VisitNotesInput) => updateVisitNotes(visitId, input, tenant),
      onSuccess: visitOnly,
    }),
    setDiscount: mutationOptions({
      ...base,
      mutationFn: (input: VisitDiscountInput) => setVisitDiscount(visitId, input, tenant),
      onSuccess: visitOnly,
    }),
    /** A new service can mark its tooth treated today. */
    addService: mutationOptions({
      ...base,
      mutationFn: (input: AddServiceInput) => addService(visitId, input, tenant),
      onSuccess: charting,
    }),
    /** A price edit changes only the visit's money, never the chart. */
    updateService: mutationOptions({
      ...base,
      mutationFn: ({ serviceId, patch }: { serviceId: string; patch: UpdateServiceInput }) =>
        updateService(visitId, serviceId, patch, tenant),
      onSuccess: visitOnly,
    }),
    /** Removing a performed plan's service also reopens the plan (the Undo of Perform). UI code
     * removes a service through `useChartingActions().removeService`, never this directly: that
     * drops the service's price save group before the DELETE. */
    removeService: mutationOptions({
      ...base,
      mutationFn: (serviceId: string) => removeService(visitId, serviceId, tenant),
      onSuccess: charting,
    }),
    recordDiagnosis: mutationOptions({
      ...base,
      mutationFn: (input: RecordDiagnosisInput) => recordDiagnosis(visitId, input, tenant),
      onSuccess: charting,
    }),
    resolveDiagnosis: mutationOptions({
      ...base,
      mutationFn: (recordId: string) => resolveDiagnosis(visitId, recordId, tenant),
      onSuccess: charting,
    }),
    reopenDiagnosis: mutationOptions({
      ...base,
      mutationFn: (recordId: string) => reopenDiagnosis(visitId, recordId, tenant),
      onSuccess: charting,
    }),
    removeDiagnosis: mutationOptions({
      ...base,
      mutationFn: (recordId: string) => removeDiagnosis(visitId, recordId, tenant),
      onSuccess: charting,
    }),
    planTreatment: mutationOptions({
      ...base,
      mutationFn: (input: PlanTreatmentInput) => planTreatment(visitId, input, tenant),
      onSuccess: charting,
    }),
    performPlan: mutationOptions({
      ...base,
      mutationFn: (planId: string) => performPlan(visitId, planId, tenant),
      onSuccess: charting,
    }),
    cancelPlan: mutationOptions({
      ...base,
      mutationFn: (planId: string) => cancelPlan(visitId, planId, tenant),
      onSuccess: charting,
    }),
    removePlan: mutationOptions({
      ...base,
      mutationFn: (planId: string) => removePlan(visitId, planId, tenant),
      onSuccess: charting,
    }),
    setToothPresence: mutationOptions({
      ...base,
      mutationFn: (input: ToothPresence) => setToothPresence(visitId, input, tenant),
      onSuccess: charting,
    }),
  };
}

/**
 * Resolves once no mutation of the visit is in flight (they share its mutation key), however
 * each ends: Complete waits for a Perform now or a removal still on its way, so the visit it
 * freezes includes them.
 */
export function visitMutationsSettled(
  queryClient: QueryClient,
  visitId: string,
  tenantId: Tenant = actingTenantId(),
): Promise<void> {
  const mutationKey = visitKeys.detail(tenantId, visitId);
  const idle = () => queryClient.isMutating({ mutationKey }) === 0;
  if (idle()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = queryClient.getMutationCache().subscribe(() => {
      if (!idle()) return;
      unsubscribe();
      resolve();
    });
  });
}

/** `visitMutationsSettled` for the acting tenant, as a stable function. */
export function useVisitMutationsSettled(visitId: string): () => Promise<void> {
  const queryClient = useQueryClient();
  const tenantId = useActingTenantId();
  return useCallback(
    () => visitMutationsSettled(queryClient, visitId, tenantId),
    [queryClient, visitId, tenantId],
  );
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
