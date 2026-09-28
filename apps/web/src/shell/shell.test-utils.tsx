import type { Session } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { parsePatientsSearch, type PatientsSearch } from '@/features/patients/list-query';
import { PatientsScreen } from '@/features/patients/patients-screen';
import { AppShell } from './app-shell';

/** Test-only: the real `AppShell` on a memory router with the real `/patients` screen and
 * stand-ins for the patient record and `/visits`, and `session` already loaded (as the `_app` guard would have it). */
export function renderShell({ url, session }: { url: string; session: Session }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, session);
  const rootRoute = createRootRoute({ component: AppShell });
  // `/patients` wired exactly as its route is (`PatientsScreen`).
  function PatientsRoute() {
    const search = parsePatientsSearch(useSearch({ strict: false }));
    const navigate = useNavigate();
    return (
      <PatientsScreen
        search={search}
        navigate={(navigation) => {
          void navigate({ to: '/patients', ...navigation });
        }}
      />
    );
  }
  const patientsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/patients',
    validateSearch: (search: Record<string, unknown>) => parsePatientsSearch(search),
    component: PatientsRoute,
  });
  const recordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/patients/$patientId',
    component: () => <p>{'Patient record'}</p>,
  });
  const visitsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/visits',
    component: () => <p>{'Visits screen'}</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([patientsRoute, recordRoute, visitsRoute]),
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
    client,
    /** Where the shell navigated to: the pathname, the `/patients` search and the history state. */
    location: () => ({
      pathname: router.state.location.pathname,
      search: parsePatientsSearch(router.state.location.search) satisfies PatientsSearch,
      state: router.state.location.state,
    }),
  };
}
