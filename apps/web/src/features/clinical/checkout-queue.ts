import {
  checkoutQueueSchema,
  type VisitBalance,
  type VisitListItem,
  type VisitListQuery,
} from '@dcm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { usePermission } from '@/features/auth/use-permission';
import { billingKeys } from '@/features/billing/billing-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/** How often the checkout queue picks up visits completed or paid elsewhere. */
export const CHECKOUT_REFETCH_MS = 30_000;

/** The branch's live visits, whatever day they started. */
export const IN_THE_CHAIR: VisitListQuery = {
  tab: 'in_progress',
  range: 'all',
  limit: 50,
  dentistId: undefined,
  roomId: undefined,
  q: undefined,
  patientId: undefined,
  cursor: undefined,
};

/** `GET /billing/checkout-queue` (ADR-0055). Under `billingKeys`, so a payment refreshes it. */
export function checkoutQueueQuery(enabled: boolean) {
  return queryOptions({
    queryKey: [...billingKeys.all(actingTenantId()), 'checkout-queue'] as const,
    queryFn: () => apiFetch('/billing/checkout-queue', checkoutQueueSchema),
    enabled,
  });
}

export interface CheckoutQueue {
  /** `payment:read`: without it nothing is asked and the queue is empty. */
  enabled: boolean;
  loading: boolean;
  failed: boolean;
  /** Oldest first: who has waited longest is served first. */
  visits: VisitListItem[];
  balanceOf: (visitId: string) => VisitBalance | undefined;
}

/**
 * The checkout queue (checkout handoff, C1, C8; ADR-0055): `GET /billing/checkout-queue` — the
 * session branch's visits of today that still owe, that nobody has paid on or checked out yet,
 * each with what it owes — polled every 30 s and on focus. One patient's amount per card, so it
 * needs `payment:read`, not the clinic's finances. The header pill and the Today board share it
 * (one query key), so they never disagree.
 *
 * A visit waits only until someone takes a payment on it or closes its checkout without one
 * (**Done** on the Today board, ADR-0033): either way it has been checked out, and what it still
 * owes is a receivable (Visits → Unpaid, Payments → Outstanding), not someone at the desk.
 */
export function useCheckoutQueue(): CheckoutQueue {
  const enabled = usePermission('payment:read');
  const queue = useQuery({
    ...checkoutQueueQuery(enabled),
    refetchInterval: CHECKOUT_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
  const items = queue.data?.items ?? [];
  return {
    enabled,
    loading: enabled && queue.isPending,
    failed: queue.isError,
    visits: items.map((item) => item.visit),
    balanceOf: (visitId) => items.find((item) => item.visit.id === visitId)?.balance,
  };
}
