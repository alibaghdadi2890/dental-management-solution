import { type ReactNode, useCallback, useState } from 'react';
import { useSession } from '@/features/auth/session';
import { AdjustBalanceContext } from './adjust-balance-context';
import { AdjustBalancePanel } from './adjust-balance-panel';

/**
 * Mounts the one Adjust balance panel (feature 7, H4), opened through `useAdjustBalance` from
 * the patient record and the Payments screen. It floats over the screen at the inline end, with
 * a scrim, like the record's catalog drawer. A new opening remounts it: a fresh form, and fresh
 * Idempotency-Keys.
 */
export function AdjustBalanceProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState<{ id: number; patientId: string } | null>(null);
  const openAdjust = useCallback((patientId: string) => {
    setOpen((current) => ({ id: (current?.id ?? 0) + 1, patientId }));
  }, []);
  return (
    <AdjustBalanceContext.Provider value={openAdjust}>
      {children}
      {open && session?.tenant && (
        <AdjustBalancePanel
          key={open.id}
          patientId={open.patientId}
          tenant={session.tenant}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </AdjustBalanceContext.Provider>
  );
}
