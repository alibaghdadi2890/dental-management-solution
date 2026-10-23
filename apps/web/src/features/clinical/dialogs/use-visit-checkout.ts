import { toCents, type Visit, type VisitFinancialSummary } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { usePermission } from '@/features/auth/use-permission';
import { useVisitSummary } from '@/features/billing/billing-api';
import { useTenantToday } from '@/features/billing/printables/use-tenant-today';
import { visitQuery } from '../visits-api';

const owes = (amount: string) => toCents(amount) > 0n;

/** A completed visit's checkout: its figures and what the caller may do with them. */
export interface VisitCheckout {
  visitId: string;
  visit: Visit | undefined;
  summary: VisitFinancialSummary | undefined;
  failed: boolean;
  /** The figures are in, or never will be: the footer can show its close action. */
  settled: boolean;
  /** The account owes (this visit plus anything from before). */
  owing: boolean;
  /** This visit owes nothing any more. */
  visitPaid: boolean;
  canCollect: boolean;
  /** The caller may set the discount now (checkout handoff, C2, C5, C7). */
  discountable: boolean;
  /** The discount could be set now, but the caller lacks `visit:discount`: "Ask the owner". */
  discountLocked: boolean;
}

/**
 * The checkout of one completed visit (checkout handoff): the visit and its
 * `GET /billing/visits/:id/summary` figures, and what the session may do — collect
 * (`payment:write`), and set the discount (`visit:discount`, on the visit's day, while it owes).
 * The post-visit dialog and the Today board's panel render the same thing from it.
 */
export function useVisitCheckout(visitId: string): VisitCheckout {
  const visit = useQuery(visitQuery(visitId));
  const summary = useVisitSummary(visitId);
  const canCollect = usePermission('payment:write');
  const canDiscount = usePermission('visit:discount');
  const today = useTenantToday();
  const failed = visit.isError || summary.isError;
  const open =
    visit.data !== undefined &&
    summary.data !== undefined &&
    (visit.data.status === 'completed' || visit.data.status === 'amended') &&
    visit.data.localDate === today &&
    owes(summary.data.visit.outstanding);
  return {
    visitId,
    visit: visit.data,
    summary: summary.data,
    failed,
    settled: summary.data !== undefined || failed,
    // Handed off (no `payment:read`, ADR-0055): only this visit's figures are known.
    owing: summary.data
      ? owes(
          summary.data.handedOff ? summary.data.visit.outstanding : summary.data.totalOutstanding,
        )
      : false,
    visitPaid: summary.data ? !owes(summary.data.visit.outstanding) : false,
    canCollect,
    discountable: canDiscount && open,
    discountLocked: !canDiscount && open,
  };
}
