import { type ReactNode, useCallback, useState } from 'react';
import { useSession } from '@/features/auth/session';
import { PaymentDialogContext, type PaymentRequestOptions } from './payment-dialog-context';
import { RecordPaymentDialog } from './record-payment-dialog';

/**
 * Mounts the one Record payment panel (feature 5): every entry point — the balance cards, an
 * expanded visit row, the post-visit summary, the Visits panel, Outstanding's Take payment —
 * opens it through `useRecordPayment`. A new opening remounts it, with a fresh Idempotency-Key.
 */
export function PaymentDialogProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState<{ id: number; options: PaymentRequestOptions } | null>(null);
  const openPayment = useCallback((options: PaymentRequestOptions) => {
    setOpen((current) => ({ id: (current?.id ?? 0) + 1, options }));
  }, []);
  return (
    <PaymentDialogContext.Provider value={openPayment}>
      {children}
      {open && session?.tenant && (
        <RecordPaymentDialog
          key={open.id}
          options={open.options}
          tenant={session.tenant}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </PaymentDialogContext.Provider>
  );
}
