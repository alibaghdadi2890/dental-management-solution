import { sessionSchema } from '@dcm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { actingTenantId, useActingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/**
 * The signed-in user, clinic, branches and permissions (`GET /session`). Keyed by the clinic a
 * platform admin is acting in, so entering or leaving a clinic loads the matching session.
 */
export function sessionQueryOptions(acting: string | null = actingTenantId()) {
  return queryOptions({
    queryKey: ['session', acting],
    queryFn: () => apiFetch('/session', sessionSchema, acting ? { tenantId: acting } : {}),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSession() {
  return useQuery(sessionQueryOptions(useActingTenantId()));
}
