import { alertTraySchema, type AlertFollowsInput } from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

export const alertKeys = {
  tray: (tenantId: string | undefined) => ['alerts', tenantId ?? 'none', 'tray'] as const,
};

/** The backstop under the stream (spec §The tray): a ping it missed shows within a minute. */
export const TRAY_REFETCH_MS = 60_000;

/** "Your patients" (`GET /alerts/tray`, feature 15). */
export const alertTrayQuery = (tenantId: string | undefined, enabled: boolean) =>
  queryOptions({
    queryKey: alertKeys.tray(tenantId),
    queryFn: () => apiFetch('/alerts/tray', alertTraySchema),
    enabled,
    refetchInterval: TRAY_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });

export const setAlertFollows = (input: AlertFollowsInput) =>
  apiFetch('/alerts/follows', z.object({ dentistIds: z.array(z.string()) }), {
    method: 'PUT',
    json: input,
  });
