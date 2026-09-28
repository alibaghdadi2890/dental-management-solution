import type { Session } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { parsePatientsSearch, type PatientsSearch } from '@/features/patients/list-query';
import { AppShell } from './app-shell';

/** Test-only: the real `AppShell` on a memory router with stand-in `/patients` and `/visits`
 * screens, and `session` already loaded (as the `_app` guard would have it). */
export function renderShell({ url, session }: { url: string; session: Session }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, session);
  const rootRoute = createRootRoute({ component: AppShell });
  const patientsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/patients',
    validateSearch: (search: Record<string, unknown>) => parsePatientsSearch(search),
    component: () => <p>{'Patients screen'}</p>,
  });
  const visitsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/visits',
    component: () => <p>{'Visits screen'}</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([patientsRoute, visitsRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return {
    router,
    /** Where the shell navigated to: the pathname and the `/patients` search it carries. */
    location: (): { pathname: string; search: PatientsSearch } => ({
      pathname: router.state.location.pathname,
      search: parsePatientsSearch(router.state.location.search),
    }),
  };
}
