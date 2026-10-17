import type { VisitStep, VisitType } from '@dcm/contracts';
import { useMutation } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStepLabel } from '../flow/flow-labels';
import { useVisitMutations } from '../visit-mutations';
import type { DiagnosisToResolve } from './diagnoses-to-resolve';
import { ResolveCheck } from './resolve-check';

/**
 * The check on the way to the Complete step (from Perform, or any step the stepper leaves): the
 * diagnoses still open on teeth treated today, to resolve now. **Back to {step}** stays where the
 * dentist was; the primary button resolves the ticked ones one by one, then moves on. Moving on
 * is always possible, ticked or not: it is a reminder, not a gate (ADR-0044). A failed resolve
 * stays here with the error; those resolved before it leave the list.
 */
export function ResolveBeforeCompleteDialog({
  visitId,
  type,
  from,
  items,
  onBack,
  onContinue,
}: {
  visitId: string;
  type: VisitType;
  /** The step the dentist is leaving. */
  from: VisitStep;
  items: readonly DiagnosisToResolve[];
  onBack: () => void;
  /** Moves on to Complete; `shown` are the diagnoses this check listed. */
  onContinue: (shown: string[]) => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const stepLabel = useStepLabel();
  const resolve = useMutation(useVisitMutations(visitId).resolveDiagnosis);
  const [left, setLeft] = useState(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = stepLabel(type, 'complete');

  const onConfirm = async (recordIds: string[]) => {
    setBusy(true);
    setError(null);
    for (const [done, recordId] of recordIds.entries()) {
      try {
        await resolve.mutateAsync(recordId);
      } catch (failure) {
        const resolved = new Set(recordIds.slice(0, done));
        setLeft((current) => current.filter((item) => !resolved.has(item.record.id)));
        setError(
          t('flow.resolve.failed', {
            reason: failure instanceof Error ? failure.message : '',
          }),
        );
        setBusy(false);
        return;
      }
    }
    onContinue(items.map((item) => item.record.id));
  };

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
          className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[540px] -translate-x-1/2 -translate-y-1/2 animate-popin overflow-hidden rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2"
        >
          <ResolveCheck
            items={left}
            busy={busy}
            error={error}
            backLabel={t('flow.resolve.back', { step: stepLabel(type, from) })}
            confirmLabel={(ticked) =>
              ticked > 0
                ? t('flow.resolve.resolveAndContinue', { count: ticked, step: complete })
                : t('flow.continueTo', { step: complete })
            }
            onBack={onBack}
            onConfirm={(recordIds) => {
              void onConfirm(recordIds);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
