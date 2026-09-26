import type { Permission } from '@dcm/contracts';
import { useSession } from './session';

/**
 * Drives UI visibility only; the API remains the enforcement point (CLAUDE.md §13).
 * Denies by default while the session is loading or unavailable.
 */
export function usePermission(permission: Permission): boolean {
  const { data } = useSession();
  return data?.permissions.includes(permission) ?? false;
}
