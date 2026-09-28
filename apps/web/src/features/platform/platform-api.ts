import {
  type BranchCreate,
  type BranchPatch,
  branchSchema,
  type PlatformTenantQuery,
  platformTenantSchema,
  type ProvisionTenantRequestInput,
  type RoomBatch,
  roleSchema,
  roomSchema,
  type StaffUserCreate,
  type StaffUserPatch,
  staffUserSchema,
  type TenantSettingsPatch,
  type TenantStatus,
  tenantSchema,
} from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/**
 * The platform admin portal's API. Platform endpoints take the tenant in the body (ADR-0008);
 * tenant-scoped endpoints are addressed with an explicit `X-Tenant-Id` for the tenant on screen.
 */
export const platformKeys = {
  tenants: ['platform', 'tenants'] as const,
  tenant: (tenantId: string) => ['platform', 'tenant', tenantId] as const,
  branches: (tenantId: string) => ['platform', 'tenant', tenantId, 'branches'] as const,
  rooms: (tenantId: string) => ['platform', 'tenant', tenantId, 'rooms'] as const,
  users: (tenantId: string) => ['platform', 'tenant', tenantId, 'users'] as const,
  roles: (tenantId: string) => ['platform', 'tenant', tenantId, 'roles'] as const,
};

export const tenantsQuery = (query: PlatformTenantQuery = {}) =>
  queryOptions({
    queryKey: [...platformKeys.tenants, query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.status) params.set('status', query.status);
      if (query.search) params.set('search', query.search);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return apiFetch(`/platform/tenants${suffix}`, z.array(platformTenantSchema));
    },
  });

export const tenantQuery = (tenantId: string) =>
  queryOptions({
    queryKey: platformKeys.tenant(tenantId),
    queryFn: () => apiFetch('/tenant', tenantSchema, { tenantId }),
  });

export const branchesQuery = (tenantId: string) =>
  queryOptions({
    queryKey: platformKeys.branches(tenantId),
    queryFn: () => apiFetch('/branches', z.array(branchSchema), { tenantId }),
  });

export const roomsQuery = (tenantId: string) =>
  queryOptions({
    queryKey: platformKeys.rooms(tenantId),
    queryFn: () => apiFetch('/rooms', z.array(roomSchema), { tenantId }),
  });

export const usersQuery = (tenantId: string) =>
  queryOptions({
    queryKey: platformKeys.users(tenantId),
    queryFn: () => apiFetch('/users', z.array(staffUserSchema), { tenantId }),
  });

export const rolesQuery = (tenantId: string) =>
  queryOptions({
    queryKey: platformKeys.roles(tenantId),
    queryFn: () => apiFetch('/roles', z.array(roleSchema), { tenantId }),
    staleTime: Infinity,
  });

export function provisionTenant(request: ProvisionTenantRequestInput) {
  return apiFetch('/platform/tenants', tenantSchema, { method: 'POST', json: request });
}

export function setTenantStatus(tenantId: string, status: TenantStatus, reason: string) {
  const action = status === 'suspended' ? 'suspend' : 'reactivate';
  return apiFetch(`/platform/tenants/${action}`, tenantSchema, {
    method: 'POST',
    json: { tenantId, reason },
  });
}

export function updateTenantSettings(tenantId: string, patch: TenantSettingsPatch) {
  return apiFetch('/tenant', tenantSchema, { method: 'PATCH', json: patch, tenantId });
}

export function createBranch(tenantId: string, branch: BranchCreate) {
  return apiFetch('/branches', branchSchema, { method: 'POST', json: branch, tenantId });
}

export function updateBranch(tenantId: string, branchId: string, patch: BranchPatch) {
  return apiFetch(`/branches/${branchId}`, branchSchema, {
    method: 'PATCH',
    json: patch,
    tenantId,
  });
}

export function saveRooms(tenantId: string, batch: RoomBatch) {
  return apiFetch('/rooms/batch', z.array(roomSchema), { method: 'POST', json: batch, tenantId });
}

export function createUser(tenantId: string, user: StaffUserCreate) {
  return apiFetch('/users', staffUserSchema, { method: 'POST', json: user, tenantId });
}

export function updateUser(tenantId: string, userId: string, patch: StaffUserPatch) {
  return apiFetch(`/users/${userId}`, staffUserSchema, { method: 'PATCH', json: patch, tenantId });
}

export function setUserActive(tenantId: string, userId: string, active: boolean, reason: string) {
  const action = active ? 'reactivate' : 'deactivate';
  return apiFetch(`/users/${userId}/${action}`, staffUserSchema, {
    method: 'POST',
    json: { reason },
    tenantId,
  });
}

export function resetUserPassword(tenantId: string, userId: string, temporaryPassword: string) {
  return apiFetch(`/users/${userId}/reset-password`, z.undefined(), {
    method: 'POST',
    json: { temporaryPassword },
    tenantId,
  });
}
