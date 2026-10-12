import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useStepLabel } from './flow-labels';
import type { VisitFlow } from './use-visit-flow';

/**
 * The step layout's footer (feature 10, V2): **← Previous**, "Step n of m", and one primary
 * button — **Continue to {next}**, or on the last step **Complete visit**, which opens the
 * visit summary as Review & complete does. Moving on is always allowed: nothing here is a gate.
 */
export function FlowFooter({
  flow,
  canComplete,
  onComplete,
}: {
  flow: VisitFlow;
  /** Completing needs `visit:write` on a live visit. */
  canComplete: boolean;
  onComplete: () => void;
}) {
  const { t } = useTranslation('clinical');
  const stepLabel = useStepLabel();
  const { previous, next } = flow;
  return (
    <footer
      aria-label={t('flow.footer')}
      className="grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-border bg-surface px-[22px] py-3 shadow-[0_-4px_14px_rgba(27,26,31,.05)]"
    >
      <div>
        <Button
          variant="outline"
          disabled={previous === null}
          onClick={() => {
            if (previous !== null) flow.goTo(previous);
          }}
          className="h-[38px] px-[15px] text-[13px]"
        >
          <span aria-hidden className="rtl:-scale-x-100">
            {'←'}
          </span>
          {t('flow.previous')}
        </Button>
      </div>
      <span className="text-[12.5px] leading-none font-medium text-ink-muted">
        {t('flow.stepOf', {
          number: flow.steps.indexOf(flow.current) + 1,
          total: flow.steps.length,
        })}
      </span>
      <div className="flex justify-end">
        {next === null ? (
          <Button
            variant="primary"
            disabled={!canComplete}
            onClick={onComplete}
            className="h-[38px] px-[17px] text-[13px] font-semibold"
          >
            {t('flow.completeVisit')}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              flow.goTo(next);
            }}
            className="h-[38px] px-[17px] text-[13px] font-semibold"
          >
            {t('flow.continueTo', { step: stepLabel(flow.type, next) })}
          </Button>
        )}
      </div>
    </footer>
  );
}
