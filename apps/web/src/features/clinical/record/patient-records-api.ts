import {
  type DiagnosisEvidence,
  patientChartResultSchema,
  type PatientChartResult,
  patientPresenceResultSchema,
  type SetPresenceOnPatientInput,
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
 * `/clinical/patients/:id/{diagnoses,plans,presence}` routes. Each answers `{ chart }`, the
 * chart as it now is.
 */
function call(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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
 * records (the tooth histories, the image viewer's citations).
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
        clinicalKeys.fileCitations(tenantId, patientId),
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
    setSeenOn: mutationOptions({
      ...base,
      mutationFn: ({ recordId, seenOn }: { recordId: string; seenOn: DiagnosisEvidence | null }) =>
        call('PATCH', patientId, `diagnoses/${recordId}/seen-on`, {
          json: { seenOn },
          tenantId: tenant,
        }),
    }),
    planTreatment: mutationOptions({
      ...base,
      mutationFn: (input: PlanPatientTreatmentInput) =>
        call('POST', patientId, 'plans', { json: input, tenantId: tenant }),
    }),
    /** The patient accepted the treatment, or that is taken back (ADR-0045). */
    setAcceptance: mutationOptions({
      ...base,
      mutationFn: ({ planId, accepted }: { planId: string; accepted: boolean }) =>
        call(accepted ? 'PUT' : 'DELETE', patientId, `plans/${planId}/acceptance`, {
          tenantId: tenant,
        }),
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
