import type { TreatmentPlan } from '@dcm/contracts';
import { useMutation } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { useLevelLabel, useToothLabel } from '../chart/use-chart-settings';
import { useVisitMutations } from '../visit-mutations';

/**
 * The question a visit opens with when the patient has unfinished services (unfinished spec U5):
 * which of them this visit continues. Each is ticked to begin with. **Continue** records this
 * visit's work on the ticked ones; **Not today** records nothing, and they stay at the top of
 * Today's services. Either answer is stored on the visit, so it is asked once. It cannot be
 * dismissed without an answer. Rendered only while there is something to ask.
 */
export function UnfinishedDialog({
  visitId,
  plans,
}: {
  visitId: string;
  /** The patient's unfinished services this visit has not worked on. */
  plans: readonly TreatmentPlan[];
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const toothLabel = useToothLabel();
  const levelLabel = useLevelLabel();
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const answer = useMutation(useVisitMutations(visitId).answerUnfinished);
  const chosen = plans.filter((plan) => !skipped.has(plan.id)).map((plan) => plan.id);
  const stay = (event: Event) => {
    event.preventDefault();
  };

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.34)]" />
        <Dialog.Content
          onEscapeKeyDown={stay}
          onPointerDownOutside={stay}
          onInteractOutside={stay}
          className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 animate-popin overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_18px_48px_rgba(27,26,31,.18)] rtl:translate-x-1/2"
        >
          <div className="px-5 pt-5 pb-3">
            <Dialog.Title className="m-0 mb-1 text-base leading-tight font-semibold tracking-[-0.01em]">
              {t('unfinished.dialogTitle')}
            </Dialog.Title>
            <Dialog.Description className="text-[13px] leading-normal text-ink-secondary">
              {t('unfinished.dialogQuestion')}
            </Dialog.Description>
          </div>
          <ul
            role="group"
            aria-label={t('unfinished.dialogTitle')}
            className="m-0 max-h-[50vh] list-none overflow-auto border-y border-warning-border p-0"
          >
            {plans.map((plan) => {
              const [first] = plan.sessions;
              return (
                <li key={plan.id} className="border-b border-warning-border last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 bg-warning-bg px-5 py-3">
                    <input
                      type="checkbox"
                      checked={!skipped.has(plan.id)}
                      disabled={answer.isPending}
                      onChange={() => {
                        setSkipped((current) => {
                          const next = new Set(current);
                          if (!next.delete(plan.id)) next.add(plan.id);
                          return next;
                        });
                      }}
                      className="size-4 flex-none cursor-pointer accent-primary"
                    />
                    <span
                      dir={plan.toothCode === null ? undefined : 'ltr'}
                      className="min-w-[52px] flex-none font-mono text-[13px] leading-none font-semibold text-primary"
                    >
                      {plan.toothCode === null ? levelLabel(plan.jaw) : toothLabel(plan.toothCode)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-[1.35] font-semibold">
                        {plan.name}
                      </span>
                      <span className="block text-[12.5px] leading-[1.4] text-ink-muted">
                        {[
                          first &&
                            t('unfinished.started', {
                              date: formatCalendarDate(first.date, locale),
                            }),
                          t('unfinished.visits', { count: plan.sessions.length }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span
                      dir="ltr"
                      className="font-mono text-[13px] leading-none font-medium text-ink-muted tabular-nums"
                    >
                      {formatMoney(plan.price, locale)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {answer.error && (
            <p
              role="alert"
              className="px-5 pt-3 text-[12.5px] leading-snug font-medium text-danger"
            >
              {t('unfinished.dialogFailed', { reason: apiErrorMessage(answer.error, i18n) })}
            </p>
          )}
          <div className="flex justify-end gap-2 px-5 py-[18px]">
            <Button
              variant="secondary"
              disabled={answer.isPending}
              onClick={() => {
                answer.mutate({ continue: [] });
              }}
            >
              {t('unfinished.notToday')}
            </Button>
            <Button
              variant="primary"
              disabled={chosen.length === 0}
              busy={answer.isPending}
              onClick={() => {
                answer.mutate({ continue: chosen });
              }}
            >
              {t('unfinished.dialogContinue')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
