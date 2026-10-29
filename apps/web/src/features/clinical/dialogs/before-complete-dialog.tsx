import type { PatientChart, Visit, VisitStep } from '@dcm/contracts';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStepLabel } from '../flow/flow-labels';
import { CompleteCheckView } from './complete-check-view';
import { useApplyCheck } from './use-apply-check';

/**
 * The check on the way to the Complete step (from Perform, or any step the stepper leaves,
 * ADR-0065): what of today's work is finished, and the diagnoses that work fixed. **Back to
 * {step}** stays where the dentist was; the primary button applies the answers, then moves on —
 * to the Complete step, or, `completing` (Complete visit on that step), to completing the visit.
 * Moving on is always possible, whatever the answers: it is a reminder, not a gate (ADR-0044). A
 * failed apply stays here with the error; what was applied before it leaves the lists.
 */
export function BeforeCompleteDialog({
  visit,
  chart,
  from,
  shown,
  completing = false,
  onBack,
  onContinue,
}: {
  visit: Visit;
  chart: PatientChart;
  /** The step the dentist is leaving. */
  from: VisitStep;
  /** What an earlier check of the page listed. */
  shown: ReadonlySet<string>;
  /** Asked from the Complete step's Complete visit: moving on completes the visit. */
  completing?: boolean;
  onBack: () => void;
  /** Moves on; `listed` is everything this check showed. */
  onContinue: (listed: string[]) => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const stepLabel = useStepLabel();
  const apply = useApplyCheck(visit.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = stepLabel(visit.type, 'complete');

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next && !busy) onBack();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.34)]" />
        <Dialog.Content
          lang={i18n.resolvedLanguage}
          className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 animate-popin overflow-hidden rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2"
        >
          <CompleteCheckView
            visit={visit}
            chart={chart}
            shown={shown}
            busy={busy}
            error={error}
            backLabel={t('flow.resolve.back', { step: stepLabel(visit.type, from) })}
            confirmLabel={(changes) =>
              completing
                ? t(changes > 0 ? 'summary.resolve.saveAndComplete' : 'summary.complete')
                : changes > 0
                  ? t('flow.resolve.saveAndContinue', { step: complete })
                  : t('flow.continueTo', { step: complete })
            }
            onBack={onBack}
            onConfirm={(decisions, listed) => {
              setBusy(true);
              setError(null);
              apply(decisions)
                .then(() => {
                  onContinue(listed);
                })
                .catch((failure: unknown) => {
                  setError(
                    t('flow.resolve.failed', {
                      reason: failure instanceof Error ? failure.message : '',
                    }),
                  );
                  setBusy(false);
                });
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
