import { type TenantSettingsPatch, tenantSchema } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/**
 * The signed-in staff member's own clinic settings (`PATCH /tenant`, `tenant:write`). Tenant is
 * implicit from the session (CLAUDE.md §12) — no `X-Tenant-Id` — unlike
 * `features/platform/platform-api.ts`'s `updateTenantSettings`, which a platform admin uses to
 * patch an explicit tenant while acting outside it.
 */
function patchTenantSettings(patch: TenantSettingsPatch) {
  return apiFetch('/tenant', tenantSchema, { method: 'PATCH', json: patch });
}

/** Patches one or more chart settings and refetches the session, so every screen that reads
 * `useChartSettings` — the chart, the tooth picker, the nav — picks up the change immediately. */
export function useUpdateTenantSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchTenantSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
