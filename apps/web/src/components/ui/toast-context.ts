import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'danger' | 'info';

export interface ToastOptions {
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

export type ShowToast = (text: string, options?: ToastOptions) => void;

export const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return toast;
}
