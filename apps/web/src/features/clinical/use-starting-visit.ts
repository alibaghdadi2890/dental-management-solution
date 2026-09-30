import { useIsMutating } from '@tanstack/react-query';
import { useActingTenantId } from '@/features/platform/acting-tenant';

/** The start popover's mutation key for one patient's start (`start-visit-popover.tsx`). */
export const startVisitKey = (tenantId: string | null, patientId: string) =>
  ['start-visit', tenantId, patientId] as const;

/**
 * Whether a start for the patient is in flight. Its cache update refetches the live-visit lists,
 * so a caller that swaps Start for Resume on those lists keeps Start (and so the popover, which
 * goes to the workspace) until the start has finished.
 */
export function useStartingVisit(patientId: string): boolean {
  const tenantId = useActingTenantId();
  return useIsMutating({ mutationKey: startVisitKey(tenantId, patientId) }) > 0;
}
