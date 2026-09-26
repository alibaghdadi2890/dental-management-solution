import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** Server state lives only in TanStack Query (CLAUDE.md §13). Client errors are not retried. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
});
