import type { TenantSettingsPatch } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateTenantSettings } from '@/features/platform/platform-api';

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
