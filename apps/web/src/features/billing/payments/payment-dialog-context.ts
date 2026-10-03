import type { RecordPaymentResult } from '@dcm/contracts';
import { createContext, useContext } from 'react';
import { useSession } from '@/features/auth/session';

/** What opens the Record payment panel (feature 5 §Screens 1). */
export interface PaymentRequestOptions {
  patientId: string;
  /** Opened from a visit or its post-visit summary: that visit is paid first (B2). */
  contextVisitId?: string | undefined;
  /** Opened from an expanded visit row: "Apply to a specific visit" preselects it (B4). */
  preselectVisitId?: string | undefined;
  /** Opened for a payer (a family): that billing contact pays, and the household is preset. */
  payerContactId?: string | undefined;
  household?: boolean | undefined;
  /** After the payment is saved (the toast has been shown). */
  onRecorded?: (result: RecordPaymentResult) => void;
}

export type OpenPayment = (options: PaymentRequestOptions) => void;

export const PaymentDialogContext = createContext<OpenPayment | null>(null);

/**
 * Opens the one Record payment panel the app shell mounts, for a caller with `payment:write`;
 * null without the permission, or outside the shell (a component rendered on its own), so the
 * caller simply shows no Record payment button.
 */
export function useRecordPayment(): OpenPayment | null {
  const open = useContext(PaymentDialogContext);
  const { data: session } = useSession();
  return open && session?.permissions.includes('payment:write') ? open : null;
}
