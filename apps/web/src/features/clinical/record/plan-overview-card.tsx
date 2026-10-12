import { type PlanPriority, planPhases } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PlanStatusPill } from '../flow/plan-status-pill';
import { useTargetLabel } from '../flow/use-target-label';
import { chartQuery } from '../visits-api';

const LABEL: Record<PlanPriority, string> = {
  urgent: 'text-danger',
  high: 'text-warning',
  elective: 'text-ink-secondary',
};

/**
 * The Overview's **Treatment plan** card (feature 10, V11): what is still to do, by priority —
 * each phase with its total, each item with where it stands — and **Open plan →** to the
 * Treatment plan tab. A phase with nothing open is left out.
 */
export function PlanOverviewCard({
  patientId,
  onOpenPlan,
}: {
  patientId: string;
  onOpenPlan: () => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const titleId = useId();
  const target = useTargetLabel();
  const chart = useQuery(chartQuery(patientId));
  const phases = planPhases(chart.data?.plans ?? []).filter((phase) => phase.open.length > 0);
  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex items-center gap-[9px] border-b border-inner-divider px-4 py-3.5">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
          {t('planTab.title')}
        </h2>
        <button
          type="button"
          onClick={onOpenPlan}
          className="ms-auto flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] leading-none font-medium text-primary hover:underline"
        >
          {t('planTab.open')}
          <span aria-hidden className="rtl:-scale-x-100">
            {'→'}
          </span>
        </button>
      </div>
      {chart.isPending ? (
        <div className="px-4 py-4">
          <CardSkeleton label={t('workspace.loading')} />
        </div>
      ) : chart.isError ? (
        <p role="alert" className="m-0 px-4 py-4 text-[12.5px] leading-snug text-ink-muted">
          {t('planTab.failed')}
        </p>
      ) : phases.length === 0 ? (
        <p className="m-0 px-4 py-4 text-[12.5px] leading-[1.4] text-ink-muted">
          {t('planTab.nothingOpen')}
        </p>
      ) : (
        phases.map((phase) => (
          <div
            key={phase.priority}
            data-phase={phase.priority}
            className="border-t border-row-divider px-4 pt-3 pb-1.5 first:border-t-0"
          >
            <div className="mb-1 flex items-baseline justify-between">
              <h3
                className={cn(
                  'm-0 text-[11.5px] leading-none font-semibold tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal',
                  LABEL[phase.priority],
                )}
              >
                {t(`flow.priority.${phase.priority}`)}
              </h3>
              {phase.total && (
                <span
                  dir="ltr"
                  className="font-mono text-[13px] leading-none font-semibold tabular-nums"
                >
                  {formatMoney(phase.total, locale)}
                </span>
              )}
            </div>
            <ul className="m-0 list-none p-0">
              {phase.open.map((plan) => (
                <li key={plan.id} className="flex items-center gap-2.5 py-[7px]">
                  <span
                    dir="ltr"
                    className="w-10 flex-none font-mono text-[12.5px] leading-none font-bold text-primary"
                  >
                    {target(plan)}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35] font-medium">
                    {plan.name}
                  </span>
                  <PlanStatusPill plan={plan} acceptance />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
