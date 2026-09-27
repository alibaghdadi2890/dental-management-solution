import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { usePermission } from '@/features/auth/use-permission';
import { practitionersQuery, staffQuery } from './users-api';

/**
 * Staff display names by auth user id, for naming a patient's dentist or an audit entry's actor:
 * every staff member (`GET /users`, deactivated ones included) with `user:read`, else — and while
 * that loads — the active practitioners. Also returns the practitioners themselves (the Primary
 * dentist and Dentist pickers).
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

  return { names, practitioners: practitioners.data };
}
