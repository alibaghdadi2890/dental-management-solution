import { sessionSchema } from '@dcm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { actingTenantId } from '@/features/platform/acting-tenant';

/**
 * The signed-in user, clinic, branches and permissions (`GET /session`). Keyed by the clinic a
 * platform admin is acting in, so entering or leaving a clinic refetches it.
 */
export function sessionQueryOptions() {
  return queryOptions({
    queryKey: ['session', actingTenantId()],
    queryFn: () => apiFetch('/session', sessionSchema),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSession() {
  return useQuery(sessionQueryOptions());
}
