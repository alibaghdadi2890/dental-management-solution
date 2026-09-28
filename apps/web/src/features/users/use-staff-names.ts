import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { usePermission } from '@/features/auth/use-permission';
import { practitionersQuery, staffQuery } from './users-api';

/**
 * Staff display names from every staff member (`GET /users`, deactivated ones included) with
 * `user:read`, else — and while that loads — the active practitioners:
 *
 * - `dentistNames`, by staff profile id (`StaffUser.profileId` / `Practitioner.id`): what a
 *   patient refers to its dentist by (ADR-0020);
 * - `names`, by auth user id (`StaffUser.id` / `Practitioner.userId`): an audit entry's actor.
 *
 * Also returns the practitioners themselves (the Primary dentist and Dentist pickers, whose values
 * are `Practitioner.id`).
 */
export function useStaffNames() {
  const canReadStaff = usePermission('user:read');
  const practitioners = useQuery(practitionersQuery());
  const staff = useQuery({ ...staffQuery(), enabled: canReadStaff });

  const names = useMemo(
    () =>
      new Map(
        staff.data?.map((user) => [user.id, user.displayName]) ??
          practitioners.data?.map((p) => [p.userId, p.displayName]) ??
          [],
      ),
    [staff.data, practitioners.data],
  );

  const dentistNames = useMemo(
    () =>
      new Map(
        staff.data?.map((user) => [user.profileId, user.displayName]) ??
          practitioners.data?.map((p) => [p.id, p.displayName]) ??
          [],
      ),
    [staff.data, practitioners.data],
  );

  return { names, dentistNames, practitioners: practitioners.data };
}
