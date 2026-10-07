import {
  patientChartResultSchema,
  type PatientChartResult,
  patientPresenceResultSchema,
  type SetPresenceOnPatientInput,
  type PlanGroupInput,
  type PlanPatientTreatmentInput,
  type RecordPatientDiagnosisInput,
  type UpdatePlanInput,
} from '@dcm/contracts';
import { mutationOptions, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { actingTenantId, useActingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { clinicalKeys } from '../visits-api';

/**
 * Charting on the patient record, outside a visit (ADR-0031): `clinical`'s
 * `/clinical/patients/:id/{diagnoses,plans,plan-groups,presence}` routes. Each answers `{ chart }`, the
 * chart as it now is.
 */
function call(
  method: 'POST' | 'PATCH' | 'DELETE',
  patientId: string,
  path: string,
  { json, tenantId }: { json?: unknown; tenantId?: string | undefined } = {},
) {
  return apiFetch(`/clinical/patients/${patientId}/${path}`, patientChartResultSchema, {
    method,
    ...(json === undefined ? {} : { json }),
    ...(tenantId === undefined ? {} : { tenantId }),
  });
}

/**
 * The patient record's charting mutations. Each `onSuccess` writes the returned chart into its
 * cache, so the tab redraws without a refetch, and invalidates what derives from the same
 * records (the tooth histories, the Overview's treatment summary).
 */
export function patientRecordMutations(
  queryClient: QueryClient,
  patientId: string,
  tenantId: string | null = actingTenantId(),
) {
  const tenant = tenantId ?? undefined;
  const onSuccess = async ({ chart }: PatientChartResult) => {
    const queryKey = clinicalKeys.chart(tenantId, patientId);
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, chart);
    await Promise.all(
      [
        clinicalKeys.toothHistories(tenantId, patientId),
        clinicalKeys.summary(tenantId, patientId),
      ].map((key) => queryClient.invalidateQueries({ queryKey: key })),
    );
  };
  const mutationKey = clinicalKeys.chart(tenantId, patientId);
  const base = { mutationKey, onSuccess };

  return {
    recordDiagnosis: mutationOptions({
      ...base,
      mutationFn: (input: RecordPatientDiagnosisInput) =>
        call('POST', patientId, 'diagnoses', { json: input, tenantId: tenant }),
    }),
    removeDiagnosis: mutationOptions({
      ...base,
      mutationFn: (recordId: string) =>
        call('DELETE', patientId, `diagnoses/${recordId}`, { tenantId: tenant }),
    }),
    planTreatment: mutationOptions({
      ...base,
      mutationFn: (input: PlanPatientTreatmentInput) =>
        call('POST', patientId, 'plans', { json: input, tenantId: tenant }),
    }),
    updatePlan: mutationOptions({
      ...base,
      mutationFn: ({ planId, patch }: { planId: string; patch: UpdatePlanInput }) =>
        call('PATCH', patientId, `plans/${planId}`, { json: patch, tenantId: tenant }),
    }),
    cancelPlan: mutationOptions({
      ...base,
      mutationFn: (planId: string) =>
        call('POST', patientId, `plans/${planId}/cancel`, { tenantId: tenant }),
    }),
    removePlan: mutationOptions({
      ...base,
      mutationFn: (planId: string) =>
        call('DELETE', patientId, `plans/${planId}`, { tenantId: tenant }),
    }),
    createGroup: mutationOptions({
      ...base,
      mutationFn: (input: PlanGroupInput) =>
        call('POST', patientId, 'plan-groups', { json: input, tenantId: tenant }),
    }),
    updateGroup: mutationOptions({
      ...base,
      mutationFn: ({ groupId, input }: { groupId: string; input: PlanGroupInput }) =>
        call('PATCH', patientId, `plan-groups/${groupId}`, { json: input, tenantId: tenant }),
    }),
    deleteGroup: mutationOptions({
      ...base,
      mutationFn: (groupId: string) =>
        call('DELETE', patientId, `plan-groups/${groupId}`, { tenantId: tenant }),
    }),
    /** Tooth presence on the record (feature 7): answers the rows written, for the Undo. */
    setPresence: mutationOptions({
      ...base,
      mutationFn: (input: SetPresenceOnPatientInput) =>
        apiFetch(`/clinical/patients/${patientId}/presence`, patientPresenceResultSchema, {
          method: 'POST',
          json: input,
          ...(tenant === undefined ? {} : { tenantId: tenant }),
        }),
    }),
    removePresence: mutationOptions({
      ...base,
      mutationFn: (ids: readonly string[]) =>
        call('DELETE', patientId, `presence?ids=${ids.join(',')}`, { tenantId: tenant }),
    }),
  };
}

/** `patientRecordMutations` for the acting tenant, stable across renders. */
export function usePatientRecordMutations(patientId: string) {
  const queryClient = useQueryClient();
  const tenantId = useActingTenantId();
  return useMemo(
    () => patientRecordMutations(queryClient, patientId, tenantId),
    [queryClient, patientId, tenantId],
  );
}
