import { type PatientChart, type PlanPriority, planPhases } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTargetLabel } from './use-target-label';

/** Each phase's top rule and label, in its tone. */
const TONE: Record<PlanPriority, { rule: string; label: string }> = {
  urgent: { rule: 'border-t-danger', label: 'text-danger' },
  high: { rule: 'border-t-warning', label: 'text-warning' },
  elective: { rule: 'border-t-ink-muted', label: 'text-ink-secondary' },
};

/**
 * The treatment plan as its three phases (feature 10, V7; ADR-0045): Urgent, High and Elective,
 * each listing **every** open item — tooth, treatment, price, and *New* for what `newIn` (this
 * visit) added — over its total.
 */
export function PhasePanels({
  chart,
  newIn,
  currency,
}: {
  chart: PatientChart;
  /** The visit whose plans are marked *New*. */
  newIn: string | null;
  /** What an empty phase's total is in. */
  currency: string;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const target = useTargetLabel();
  const zero = { amount: '0.00', currency };
  return (
    <>
      {planPhases(chart.plans).map((phase) => (
        <section
          key={phase.priority}
          aria-label={t(`flow.priority.${phase.priority}`)}
          data-phase={phase.priority}
          className={cn(
            'flex min-w-0 flex-[1_1_240px] flex-col gap-2.5 rounded-xl border border-t-[3px] border-border bg-surface px-4 py-3.5',
            TONE[phase.priority].rule,
          )}
        >
          <div className="flex items-baseline justify-between">
            <h3
              className={cn(
                'm-0 text-[11.5px] leading-none font-semibold tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal',
                TONE[phase.priority].label,
              )}
            >
              {t(`flow.priority.${phase.priority}`)}
            </h3>
            <span className="text-[12px] leading-none text-ink-muted">
              {t('flow.phase.items', { count: phase.open.length })}
            </span>
          </div>
          {phase.open.length === 0 ? (
            <p className="m-0 border-t border-row-divider py-1.5 text-[12.5px] leading-[1.4] text-ink-muted">
              {t('flow.phase.none')}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {phase.open.map((plan) => (
                <li
                  key={plan.id}
                  className="flex items-baseline gap-2 border-t border-row-divider py-1.5 text-[12.5px] leading-[1.35]"
                >
                  <span dir="ltr" className="w-[38px] flex-none font-mono font-bold text-primary">
                    {target(plan)}
                  </span>
                  <span className="min-w-0 flex-1 font-medium">{plan.name}</span>
                  {newIn !== null && plan.recordedInVisitId === newIn && (
                    <span className="flex-none rounded-[4px] border border-primary-tint-border bg-primary-tint px-1.5 py-0.5 text-[11px] leading-none font-semibold text-primary">
                      {t('flow.phase.new')}
                    </span>
                  )}
                  <span dir="ltr" className="flex-none font-mono font-medium tabular-nums">
                    {formatMoney(plan.price, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto flex items-baseline justify-between border-t border-border pt-[9px]">
            <span className="text-[12.5px] leading-none font-semibold">
              {t('flow.phase.total')}
            </span>
            <span dir="ltr" className="font-mono text-[17px] leading-none font-bold tabular-nums">
              {formatMoney(phase.total ?? zero, locale)}
            </span>
          </div>
        </section>
      ))}
    </>
  );
}
