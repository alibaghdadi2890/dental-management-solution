import { practitionerSchema, staffUserSchema } from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/**
 * Tenant staff reads for the clinic app (`users` module). Keys are scoped under the acting
 * tenant, like `patientKeys`, so a platform admin switching clinics never sees another clinic's
 * staff.
 */
export const userKeys = {
  practitioners: (tenantId: string | null) => ['users', tenantId, 'practitioners'] as const,
  staff: (tenantId: string | null) => ['users', tenantId, 'staff'] as const,
};

/** Omitted entirely when the caller relies on the ambient acting tenant (`apiFetch`'s default). */
const scope = (tenantId?: string) => (tenantId === undefined ? {} : { tenantId });

/** `GET /users/practitioners`: active dentists, for pickers (the Primary dentist select, the
 * list's Dentist filter). */
export function practitionersQuery(tenantId?: string) {
  return queryOptions({
    queryKey: userKeys.practitioners(tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/users/practitioners', z.array(practitionerSchema), scope(tenantId)),
  });
}

/** `GET /users`: every staff member, deactivated ones included (`user:read`), so a patient's
 * dentist is still named after they leave the clinic. */
export function staffQuery(tenantId?: string) {
  return queryOptions({
    queryKey: userKeys.staff(tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/users', z.array(staffUserSchema), scope(tenantId)),
  });
}
