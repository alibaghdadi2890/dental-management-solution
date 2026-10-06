import {
  toCents,
  type VisitBalance,
  type VisitListItem,
  type VisitListQuery,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { usePermission } from '@/features/auth/use-permission';
import { visitBalancesQuery, visitPageQuery } from './visits-list/visits-list-api';

/** How often the checkout queue picks up visits completed or paid elsewhere. */
export const CHECKOUT_REFETCH_MS = 30_000;

const NO_FILTERS = {
  dentistId: undefined,
  roomId: undefined,
  q: undefined,
  patientId: undefined,
  cursor: undefined,
} as const;

/** Today's visits of the branch that still owe (checkout handoff, C1); a day's worth fits a page. */
const QUEUE: VisitListQuery = { tab: 'all', range: 'today', limit: 50, ...NO_FILTERS };

/** The branch's live visits, whatever day they started. */
export const IN_THE_CHAIR: VisitListQuery = {
  tab: 'in_progress',
  range: 'all',
  limit: 50,
  ...NO_FILTERS,
};

export interface CheckoutQueue {
  /** `payment:write` and `visit:read`: without them nothing is asked and the queue is empty. */
  enabled: boolean;
  loading: boolean;
  failed: boolean;
  /** Oldest first: who has waited longest is served first. */
  visits: VisitListItem[];
  balanceOf: (visitId: string) => VisitBalance | undefined;
}

/**
 * The checkout queue (checkout handoff, C1, C8): `GET /billing/visits/unpaid?range=today` — the
 * session branch's visits of today that still owe — with what each owes, polled every 30 s and on
 * focus. The header pill and the Today board share it (one query key), so they never disagree.
 *
 * A visit waits only until someone takes a payment on it or closes its checkout without one
 * (**Done** on the Today board, ADR-0033): either way it has been checked out, and what it still
 * owes is a receivable (Visits → Unpaid, Payments → Outstanding), not someone standing at the
 * desk. So the queue is the owing visits nothing was paid on and nobody closed, and it is known
 * only once the balances are in.
 */
export function useCheckoutQueue(): CheckoutQueue {
  const canCollect = usePermission('payment:write');
  const canVisits = usePermission('visit:read');
  const enabled = canCollect && canVisits;
  const queue = useQuery({
    ...visitPageQuery(QUEUE, true),
    enabled,
    refetchInterval: CHECKOUT_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
  const owing = [...(queue.data?.items ?? [])].reverse();
  // Polled too: a payment taken at another desk changes what a visit owes, not the list of ids.
  const balances = useQuery({
    ...visitBalancesQuery(
      owing.map((visit) => visit.id),
      enabled,
    ),
    refetchInterval: CHECKOUT_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
  const balanceOf = (visitId: string) => balances.data?.find((row) => row.visitId === visitId);
  const untouched = (visit: VisitListItem) => {
    const balance = balanceOf(visit.id);
    return visit.checkedOutAt === null && balance !== undefined && toCents(balance.paid) === 0n;
  };
  return {
    enabled,
    loading: enabled && (queue.isPending || (owing.length > 0 && balances.isPending)),
    failed: queue.isError || balances.isError,
    visits: owing.filter(untouched),
    balanceOf,
  };
}
