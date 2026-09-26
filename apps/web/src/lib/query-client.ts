import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

type UnauthenticatedHandler = (error: ApiError) => void;

let onUnauthenticated: UnauthenticatedHandler = () => undefined;

/** Registered by the router: a 401 in the middle of work ends the session (expired, revoked). */
export function handleUnauthenticated(handler: UnauthenticatedHandler): void {
  onUnauthenticated = handler;
}

function report(error: Error, queryKey?: readonly unknown[]): void {
  // The session query is handled by the route guard and the login screen.
  if (error instanceof ApiError && error.status === 401 && queryKey?.[0] !== 'session') {
    onUnauthenticated(error);
  }
}

/** Server state lives only in TanStack Query (CLAUDE.md §13). Client errors are not retried. */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      report(error, query.queryKey);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      report(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
});
