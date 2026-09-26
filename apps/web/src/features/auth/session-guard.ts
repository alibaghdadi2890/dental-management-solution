import { AUTH_PROBLEM_CODES, type Session } from '@dcm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { actingTenantId, stopActing } from '@/features/platform/acting-tenant';
import { ApiError } from '@/lib/api';
import { sessionQueryOptions } from './session';

/** Where a freshly signed-in user starts. */
export function landingPath(session: Session): '/admin/tenants' | '/patients' {
  return session.platformAdmin && session.tenant === null ? '/admin/tenants' : '/patients';
}

/** The login screen's notice after being sent there. */
export type LoginReason = 'expired' | 'suspended';

function toLogin(reason?: LoginReason): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
  throw redirect({ to: '/login', search: reason ? { reason } : {} });
}

async function loadSession(queryClient: QueryClient): Promise<Session> {
  try {
    return await queryClient.query(sessionQueryOptions());
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === AUTH_PROBLEM_CODES.sessionExpired) toLogin('expired');
      if (error.code === AUTH_PROBLEM_CODES.tenantSuspended) toLogin('suspended');
      if (error.status === 401 || error.status === 403) toLogin();
    }
    throw error;
  }
}

/**
 * The app shell's gate (spec: Frontend › Guarding): unauthenticated → `/login`, pending password
 * change → `/login`, platform admin outside a clinic → `/admin`, others kept out of `/admin`.
 */
export async function requireAppSession(
  queryClient: QueryClient,
  pathname: string,
): Promise<Session> {
  const onAdmin = pathname.startsWith('/admin');
  if (onAdmin && actingTenantId() !== null) {
    // The portal always addresses tenants explicitly; leaving a clinic ends "Manage in clinic".
    stopActing();
  }
  const session = await loadSession(queryClient);
  if (session.mustChangePassword) toLogin();
  if (onAdmin && !session.platformAdmin) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/' });
  }
  if (!onAdmin && session.platformAdmin && session.tenant === null) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown
    throw redirect({ to: '/admin/tenants' });
  }
  return session;
}
