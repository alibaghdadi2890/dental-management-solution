import {
  openingBalanceResultSchema,
  patientBalanceSchema,
  patientBalancesSchema,
  type CreateWithOpeningBalance,
} from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/**
 * Balances for the patients list/record (design "Frontend" §Patients list, §Right panel). Opening
 * balances and balance reads live in `billing`; `patients` never imports it (design Q1, Q5).
 */
export const billingKeys = {
  balances: (ids: readonly string[]) => ['billing', 'balances', [...ids].sort()] as const,
  balance: (id: string) => ['billing', 'balance', id] as const,
};

/**
 * `GET /billing/balances?patientIds=` for the list's currently visible page. Disabled for an
 * empty id list (nothing to ask for) rather than sending `patientIds=`, which
 * `balancesQuerySchema` rejects outright (`.min(1)`).
 */
export function balancesQuery(ids: readonly string[]) {
  return queryOptions({
    queryKey: billingKeys.balances(ids),
    queryFn: () => apiFetch(`/billing/balances?patientIds=${ids.join(',')}`, patientBalancesSchema),
    enabled: ids.length > 0,
  });
}

/** `GET /billing/patients/:id/balance`: the record's Overview "Balance" card. */
export function balanceQuery(id: string) {
  return queryOptions({
    queryKey: billingKeys.balance(id),
    queryFn: () => apiFetch(`/billing/patients/${id}/balance`, patientBalanceSchema),
  });
}

/** `POST /billing/opening-balances` (design Q1): one transaction, `PatientsService.create` then
 * the ledger entry. Used instead of `createPatient` only when `wantsOpeningBalance` is true. */
export function createWithOpeningBalance(input: CreateWithOpeningBalance) {
  return apiFetch('/billing/opening-balances', openingBalanceResultSchema, {
    method: 'POST',
    json: input,
  });
}
