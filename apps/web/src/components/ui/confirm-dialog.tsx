import { AlertDialog } from 'radix-ui';
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { ConfirmContext, type ConfirmOptions } from './confirm-context';

const MIN_REASON = 3;

/** Presentational POC confirm dialog: 420px card, "!" icon, optional reason textarea. */
export function ConfirmDialog({
  options,
  onClose,
}: {
  options: ConfirmOptions;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const danger = options.tone === 'danger';
  const blocked = options.reasonLabel !== undefined && reason.trim().length < MIN_REASON;

  const confirm = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      await options.onConfirm(reason.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.28)]" />
        <AlertDialog.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 animate-popin rounded-2xl border border-border bg-surface shadow-[0_18px_48px_rgba(27,26,31,.18)] rtl:translate-x-1/2">
          <div className="flex items-start gap-3 px-5 pt-5 pb-1">
            <span
              aria-hidden
              className={cn(
                'grid size-8 flex-none place-items-center rounded-full border text-sm leading-none font-bold',
                danger
                  ? 'border-danger-border bg-danger-bg text-danger'
                  : 'border-warning-border bg-warning-bg text-warning',
              )}
            >
              {'!'}
            </span>
            <div className="min-w-0">
              <AlertDialog.Title className="mt-0.5 mb-1.5 text-base leading-tight font-semibold tracking-[-0.01em]">
                {options.title}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-[13px] leading-normal text-ink-secondary">
                {options.body}
              </AlertDialog.Description>
            </div>
          </div>
          {options.reasonLabel !== undefined && (
            <label className="block ps-16 pe-5 pt-3.5">
              <span className="mb-1.5 block text-[12.5px] leading-none font-medium">
                {options.reasonLabel}
              </span>
              <textarea
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                rows={3}
                placeholder={t('reasonPlaceholder')}
                className="w-full resize-y rounded-lg border border-border-control bg-surface px-2.5 py-[9px] text-[13px] leading-[1.45]"
              />
            </label>
          )}
          <div className="flex justify-end gap-2 px-5 py-[18px]">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{options.cancelLabel ?? t('cancel')}</Button>
            </AlertDialog.Cancel>
            <Button
              variant={danger ? 'dangerSolid' : 'primary'}
              disabled={blocked}
              busy={busy}
              onClick={() => {
                void confirm();
              }}
            >
              {options.okLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
  }, []);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <ConfirmDialog
          key={options.title}
          options={options}
          onClose={() => {
            // A confirmation may open a follow-up dialog (delete → "used on visits"); keep it.
            setOptions((current) => (current === options ? null : current));
          }}
        />
      )}
    </ConfirmContext.Provider>
  );
}
