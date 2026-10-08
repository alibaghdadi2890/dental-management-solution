import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { TOAST_REGION, ToastContext, type ToastOptions, type ToastTone } from './toast-context';

interface Toast extends ToastOptions {
  id: number;
  text: string;
}

const MAX_TOASTS = 3;
const TOAST_MS = 5_000;
const DOT: Record<ToastTone, string> = {
  success: 'bg-[#6fbf8e]',
  danger: 'bg-[#e38b7b]',
  info: 'bg-[#9ca1e0]',
};

let nextId = 1;

/** POC toasts: bottom-end of the screen, at most 3, 5 s auto-dismiss, optional action. Above the
 * dialogs' layer: an action taken in the full-screen file viewer shows its toast (and its Undo)
 * over it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (text: string, options: ToastOptions = {}) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, text, ...options }].slice(-MAX_TOASTS));
      setTimeout(() => {
        dismiss(id);
      }, TOAST_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        {...{ [TOAST_REGION]: '' }}
        aria-live="polite"
        className="pointer-events-none fixed end-5 bottom-5 z-[60] flex flex-col items-end gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex max-w-[420px] min-w-[280px] animate-toastin items-center gap-2.5 rounded-[9px] bg-ink py-2.5 ps-3.5 pe-2.5 text-white shadow-[0_10px_28px_rgba(27,26,31,.24)]"
          >
            <span
              className={cn('size-[7px] flex-none rounded-full', DOT[toast.tone ?? 'success'])}
            />
            <span className="min-w-0 flex-1 text-[12.5px] leading-[1.4] font-medium">
              <span className="block">{toast.text}</span>
              {toast.body && (
                <span className="block text-[11.5px] leading-[1.4] font-normal opacity-[.72]">
                  {toast.body}
                </span>
              )}
            </span>
            {toast.actionLabel && (
              <button
                type="button"
                onClick={() => {
                  toast.onAction?.();
                  dismiss(toast.id);
                }}
                className="h-[26px] flex-none cursor-pointer rounded-[5px] border border-[#4a4852] px-[9px] text-xs leading-none font-medium hover:bg-[#2e2d34]"
              >
                {toast.actionLabel}
              </button>
            )}
            <button
              type="button"
              aria-label={t('dismiss')}
              onClick={() => {
                dismiss(toast.id);
              }}
              className="grid size-6 flex-none cursor-pointer place-items-center text-[#a8a49b] hover:text-white"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="m2 2 6 6M8 2 2 8" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
