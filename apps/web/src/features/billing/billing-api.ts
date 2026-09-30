import {
  openingBalanceResultSchema,
  patientBalanceSchema,
  patientBalancesSchema,
  visitFinancialSummarySchema,
  type CreateWithOpeningBalanceInput,
} from '@dcm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/**
 * Balances for the patients list/record (design "Frontend" §Patients list, §Right panel). Opening
 * balances and balance reads live in `billing`; `patients` never imports it (design Q1, Q5).
 *
 * Every key is scoped under the acting tenant (`patientKeys`'s pattern,
 * `features/patients/patients-api.ts`), so `invalidatePatientData` there can invalidate exactly
 * one tenant's balances via `billingKeys.all`, and switching which clinic a platform admin is
 * acting in never shows a stale cached balance from the clinic they left.
 */
export const billingKeys = {
  all: (tenantId: string | null) => ['billing', tenantId] as const,
  balances: (tenantId: string | null, ids: readonly string[]) =>
    [...billingKeys.all(tenantId), 'balances', [...ids].sort()] as const,
  balance: (tenantId: string | null, id: string) =>
    [...billingKeys.all(tenantId), 'balance', id] as const,
  visitSummary: (tenantId: string | null, visitId: string) =>
    [...billingKeys.all(tenantId), 'visit-summary', visitId] as const,
};

/** Omitted entirely (rather than sent as `{}`) when `tenantId` is left to the caller's ambient
 * acting tenant — `apiFetch` already defaults to `actingTenantId()` itself; this only forwards an
 * *explicit* tenant, matching `catalog-api.ts`'s `scope`. */
const scope = (tenantId?: string) => (tenantId === undefined ? {} : { tenantId });

/**
 * `GET /billing/balances?patientIds=` for the list's currently visible page. Disabled for an
 * empty id list (nothing to ask for) rather than sending `patientIds=`, which
 * `balancesQuerySchema` rejects outright (`.min(1)`).
 */
export function balancesQuery(ids: readonly string[], tenantId?: string) {
  return queryOptions({
    queryKey: billingKeys.balances(tenantId ?? actingTenantId(), ids),
    queryFn: () =>
      apiFetch(
        `/billing/balances?patientIds=${ids.join(',')}`,
        patientBalancesSchema,
        scope(tenantId),
      ),
    enabled: ids.length > 0,
  });
}

/** `GET /billing/patients/:id/balance`: the record's Overview "Balance" card. */
export function balanceQuery(id: string, tenantId?: string) {
  return queryOptions({
    queryKey: billingKeys.balance(tenantId ?? actingTenantId(), id),
    queryFn: () =>
      apiFetch(`/billing/patients/${id}/balance`, patientBalanceSchema, scope(tenantId)),
  });
}

/** `GET /billing/visits/:visitId/summary`: a completed visit's figures from the ledger (spec
 * W2): this visit, the earlier visits and the total outstanding, in the visit's currency. */
export function visitSummaryQuery(visitId: string, tenantId?: string) {
  return queryOptions({
    queryKey: billingKeys.visitSummary(tenantId ?? actingTenantId(), visitId),
    queryFn: () =>
      apiFetch(`/billing/visits/${visitId}/summary`, visitFinancialSummarySchema, scope(tenantId)),
  });
}

/** The post-visit summary's figures (`visitSummaryQuery`) for the acting tenant. */
export function useVisitSummary(visitId: string) {
  return useQuery(visitSummaryQuery(visitId));
}

/** `POST /billing/opening-balances` (design Q1): one transaction, `PatientsService.create` then
 * the ledger entry. Used instead of `createPatient` only when `wantsOpeningBalance` is true. */
export function createWithOpeningBalance(input: CreateWithOpeningBalanceInput) {
  return apiFetch('/billing/opening-balances', openingBalanceResultSchema, {
    method: 'POST',
    json: input,
  });
}
