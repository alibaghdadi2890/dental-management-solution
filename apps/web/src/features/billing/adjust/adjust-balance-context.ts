import { createContext, useContext } from 'react';
import { useSession } from '@/features/auth/session';

export type OpenAdjustBalance = (patientId: string) => void;

export const AdjustBalanceContext = createContext<OpenAdjustBalance | null>(null);

/**
 * The Adjust balance action (feature 7, H4) for the entry points that show it: the balance card,
 * the Overview card's menu, an Outstanding row's menu. Callers with `payment:read` see the
 * action; only `payment:refund` (owner, dentist) may use it — `open` is null otherwise, and the
 * entry point says "Ask a dentist to adjust", as refunds do. Null without `payment:read`, or
 * outside the app shell, so the caller shows nothing.
 */
export function useAdjustBalance(): { open: OpenAdjustBalance | null } | null {
  const open = useContext(AdjustBalanceContext);
  const { data: session } = useSession();
  if (!open || !session?.permissions.includes('payment:read')) return null;
  return { open: session.permissions.includes('payment:refund') ? open : null };
}
