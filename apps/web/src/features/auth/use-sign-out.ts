import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { stopActing } from '@/features/platform/acting-tenant';
import { signOut } from './auth-api';
import type { LoginReason } from './session-guard';

/** Ends the session, forgets all server state and returns to the login screen. */
export function useSignOut(): (reason?: LoginReason) => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(
    async (reason?: LoginReason) => {
      await signOut().catch(() => undefined);
      stopActing();
      queryClient.clear();
      await navigate({ to: '/login', search: reason ? { reason } : {} });
    },
    [queryClient, navigate],
  );
}
