import { branchSchema, roomSchema, type TenantSettingsPatch } from '@dcm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { updateTenantSettings } from '@/features/platform/platform-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/** Keys scoped under the acting tenant, like `userKeys`, so a platform admin switching clinics
 * never sees another clinic's rooms. */
export const tenancyKeys = {
  rooms: (tenantId: string | null, branchId: string) =>
    ['tenancy', tenantId, 'rooms', branchId] as const,
  branches: (tenantId: string | null) => ['tenancy', tenantId, 'branches'] as const,
};

/** Omitted entirely when the caller relies on the ambient acting tenant (`apiFetch`'s default). */
const scope = (tenantId?: string) => (tenantId === undefined ? {} : { tenantId });

/** `GET /rooms?branchId=`: one branch's rooms, inactive ones included (the start visit popover's
 * Room select keeps the active ones, W7). */
export function branchRoomsQuery(branchId: string, tenantId?: string) {
  return queryOptions({
    queryKey: tenancyKeys.rooms(tenantId ?? actingTenantId(), branchId),
    queryFn: () =>
      apiFetch(
        `/rooms?${new URLSearchParams({ branchId }).toString()}`,
        z.array(roomSchema),
        scope(tenantId),
      ),
  });
}

/**
 * The signed-in staff member's own clinic settings (`PATCH /tenant`, `tenant:write`). Reuses
 * `features/platform/platform-api.ts`'s `updateTenantSettings` with no `tenantId`, so it falls
 * back to the caller's own session tenant (CLAUDE.md §12) instead of a platform admin's explicit
 * one.
 */
export function useUpdateTenantSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    // Wrapped, not passed directly: `useMutation` calls its `mutationFn` with a second
    // (`context`) argument that would otherwise land in `updateTenantSettings`'s `tenantId`.
    mutationFn: (patch: TenantSettingsPatch) => updateTenantSettings(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

/** `GET /branches`: the clinic's branches with address and phone (the printables' clinic block). */
export function branchesQuery() {
  return queryOptions({
    queryKey: tenancyKeys.branches(actingTenantId()),
    queryFn: () => apiFetch('/branches', z.array(branchSchema)),
  });
}
