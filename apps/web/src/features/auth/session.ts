import { sessionSchema } from '@dcm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/** The signed-in user, tenant and permissions, served by the API `auth` module. */
export const sessionQueryOptions = queryOptions({
  queryKey: ['session'],
  queryFn: () => apiFetch('/session', sessionSchema),
  staleTime: 5 * 60_000,
  retry: false,
});

export function useSession() {
  return useQuery(sessionQueryOptions);
}
