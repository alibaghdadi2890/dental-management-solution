import { createContext, useContext } from 'react';

export interface ConfirmOptions {
  title: string;
  body: string;
  okLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warn';
  /** When set, a reason (≥ 3 characters, saved to the audit trail) is required. */
  reasonLabel?: string;
  /** With `reasonLabel`: the reason textarea is shown but may be left empty (e.g. archive). */
  reasonOptional?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
}

export const ConfirmContext = createContext<((options: ConfirmOptions) => void) | null>(null);

export function useConfirm(): (options: ConfirmOptions) => void {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>');
  }
  return confirm;
}
