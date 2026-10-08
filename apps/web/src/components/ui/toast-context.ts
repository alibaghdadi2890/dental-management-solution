import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'danger' | 'info';

export interface ToastOptions {
  tone?: ToastTone;
  /** A second line under the text (the POC's toast body, at 72% opacity). */
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export type ShowToast = (text: string, options?: ToastOptions) => void;

/** Marks the toasts' container, so a modal can tell a click on a toast from a click outside. */
export const TOAST_REGION = 'data-toast-region';

/**
 * For a modal dialog's `onPointerDownOutside` / `onInteractOutside`: a toast is shown above the
 * dialog, and using it (its Undo, its dismiss) must not count as leaving the dialog.
 */
export function keepOpenForToast(event: CustomEvent<{ originalEvent: Event }>): void {
  const { target } = event.detail.originalEvent;
  if (target instanceof Element && target.closest(`[${TOAST_REGION}]`)) event.preventDefault();
}

export const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return toast;
}
