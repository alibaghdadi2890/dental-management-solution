import { canReadVisit, ownsVisit, type Permission, type VisitOwnership } from '@dcm/contracts';
import { useSession } from './session';

/**
 * Drives UI visibility only; the API remains the enforcement point (CLAUDE.md §13).
 * Denies by default while the session is loading or unavailable.
 */
export function usePermission(permission: Permission): boolean {
  const { data } = useSession();
  return data?.permissions.includes(permission) ?? false;
}

/**
 * Whether the caller reads this visit (ADR-0055, the same `canReadVisit` the API applies): every
 * visit with `visit:read_all`, their own (dentist or starter) with `visit:read`. Hides a link the
 * API would answer 404.
 */
export function useCanReadVisit(): (visit: VisitOwnership) => boolean {
  const { data } = useSession();
  return (visit) =>
    data !== undefined &&
    canReadVisit(
      {
        permissions: data.permissions,
        userId: data.user.id,
        profileId: data.profile?.id ?? null,
      },
      visit,
    );
}

/** Whether the visit is the caller's own (dentist or starter): they always see its prices. */
export function useOwnsVisit(): (visit: VisitOwnership) => boolean {
  const { data } = useSession();
  return (visit) =>
    data !== undefined &&
    ownsVisit({ userId: data.user.id, profileId: data.profile?.id ?? null }, visit);
}
