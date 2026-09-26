import { AUTH_PROBLEM_CODES } from '@dcm/contracts';
import { createRouter } from '@tanstack/react-router';
import { handleUnauthenticated, queryClient } from './lib/query-client';
import { routeTree } from './routeTree.gen';
import type { NavKey } from './shell/nav-items';

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  scrollRestoration: true,
});

handleUnauthenticated((error) => {
  if (router.state.location.pathname === '/login') return;
  queryClient.clear();
  void router.navigate({
    to: '/login',
    search: error.code === AUTH_PROBLEM_CODES.sessionExpired ? { reason: 'expired' } : {},
  });
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** Sidebar entry this route belongs to; also labels the header breadcrumb. */
    navKey?: NavKey;
  }
}
