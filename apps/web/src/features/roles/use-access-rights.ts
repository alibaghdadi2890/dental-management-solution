import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';

/**
 * Whether the viewer sees and edits who may do what (ADR-0055): `role:read` / `role:write` in
 * their clinic, and manages staff accounts (`user:write`): someone with `role:write` alone gives
 * people access but does not edit their profiles. A platform admin in the portal acts on a clinic
 * from outside it, so their session holds none of the clinic's permissions; the API grants them
 * everything there (ADR-0008).
 */
export function useAccessRights(): { read: boolean; write: boolean; manageStaff: boolean } {
  const { data } = useSession();
  const admin = data?.platformAdmin === true;
  const read = usePermission('role:read');
  const write = usePermission('role:write');
  const manageStaff = usePermission('user:write');
  return { read: admin || read, write: admin || write, manageStaff: admin || manageStaff };
}
