import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToothLabel } from '../chart/use-chart-settings';
import type { DiagnosisToResolve } from './diagnoses-to-resolve';

/**
 * The check before a visit is completed: the active diagnoses on teeth treated today
 * (`diagnosesToResolve`), each with what was done and an unticked **Resolve**. Nothing is
 * resolved unless the dentist ticks it. The back button returns with nothing changed; the primary
 * one goes on, resolving the ticked ones first. The body of a dialog: the move from a step to
 * Complete (`ResolveBeforeCompleteDialog`), or the Visit Summary in place of the summary.
 */
export function ResolveCheck({
  items,
  busy,
  error,
  backLabel,
  confirmLabel,
  onBack,
  onConfirm,
}: {
  items: readonly DiagnosisToResolve[];
  /** Resolving or moving on: the controls are disabled. */
  busy: boolean;
  error: string | null;
  backLabel: string;
  /** The primary button, for how many are ticked (0: go on without resolving). */
  confirmLabel: (ticked: number) => string;
  onBack: () => void;
  onConfirm: (recordIds: string[]) => void;
}) {
  const { t } = useTranslation('clinical');
  const toothLabel = useToothLabel();
  // The body changed under the user: say so by moving focus to the new title.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const chosen = items.filter((item) => ticked.has(item.record.id)).map((item) => item.record.id);
  const toggle = (id: string, on: boolean) => {
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <>
      <div className="border-b border-inner-divider px-[22px] pt-[18px] pb-[15px]">
        <Dialog.Title
          ref={title}
          tabIndex={-1}
          className="m-0 mb-[3px] text-[16.5px] leading-[1.2] font-semibold tracking-[-0.01em] outline-none"
        >
          {t('summary.resolve.title')}
        </Dialog.Title>
        <Dialog.Description className="m-0 text-[12.5px] leading-snug text-ink-muted">
          {t('summary.resolve.subtitle')}
        </Dialog.Description>
      </div>
      <div className="max-h-[56vh] overflow-auto px-[22px] py-[18px]">
        <p
          role="note"
          className="m-0 mb-3.5 rounded-lg border border-warning-border bg-warning-bg px-3.5 py-2.5 text-[12.5px] leading-snug font-medium text-warning"
        >
          {t('summary.resolve.warning', { count: items.length })}
        </p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map(({ record, services }) => {
            const on = ticked.has(record.id);
            return (
              <li key={record.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-[9px] border px-3.5 py-3',
                    on ? 'border-success-border bg-success-bg' : 'border-border bg-faint',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    aria-label={t('summary.resolve.tick', {
                      name: record.name,
                      tooth: toothLabel(record.toothCode),
                    })}
                    onChange={(event) => {
                      toggle(record.id, event.target.checked);
                    }}
                    className="m-0 mt-0.5 size-[18px] flex-none accent-success"
                  />
                  <span className="flex-1">
                    <span className="block text-[13px] leading-[1.35] font-semibold">
                      <span dir="ltr" className="font-mono">
                        {toothLabel(record.toothCode)}
                      </span>
                      {' · '}
                      {record.name}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">
                      {t('summary.resolve.doneToday', {
                        services: services.map((service) => service.name).join(', '),
                      })}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'flex-none text-[12px] font-medium',
                      on ? 'text-success' : 'text-ink-muted',
                    )}
                  >
                    {t('summary.resolve.resolve')}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      {error !== null && (
        <p
          role="alert"
          className="m-0 border-t border-danger-border bg-danger-bg px-[22px] py-2.5 text-[12.5px] leading-snug font-medium text-danger"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-inner-divider bg-sunken px-[22px] py-3.5">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={onBack}
          className="h-[38px] text-[13px]"
        >
          {backLabel}
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            onConfirm(chosen);
          }}
          className="h-[38px] px-[17px] text-[13px] font-semibold disabled:cursor-wait disabled:opacity-80"
        >
          {busy ? t('summary.resolve.working') : confirmLabel(chosen.length)}
        </Button>
      </div>
    </>
  );
}
