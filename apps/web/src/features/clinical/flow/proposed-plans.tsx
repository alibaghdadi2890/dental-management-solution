import type { TreatmentPlan } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { useChartingActions } from '../workspace/charting-actions';
import { PriorityChip } from './priority-chip';
import { useTargetLabel } from './use-target-label';

/**
 * The treatments proposed on a Plan step card (feature 10, V7): name, price and — for one that
 * has not been started — Remove. `withTarget` adds where each one goes and its priority, for the
 * card whose treatments are not all on one tooth.
 */
export function ProposedPlans({
  plans,
  canWrite,
  withTarget = false,
}: {
  plans: readonly TreatmentPlan[];
  canWrite: boolean;
  withTarget?: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const target = useTargetLabel();
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {plans.map((plan) => (
        <li
          key={plan.id}
          data-plan={plan.id}
          className="flex flex-wrap items-center gap-2.5 rounded-[7px] border border-planned-border bg-planned-bg px-[11px] py-[9px]"
        >
          {withTarget && (
            <span
              dir={plan.toothCode === null ? undefined : 'ltr'}
              className="flex-none font-mono text-[12.5px] leading-none font-bold text-primary"
            >
              {target(plan)}
            </span>
          )}
          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35] font-semibold">
            {plan.name}
          </span>
          {withTarget && <PriorityChip priority={plan.priority} />}
          <span dir="ltr" className="font-mono text-[13px] leading-none font-semibold tabular-nums">
            {formatMoney(plan.price, locale)}
          </span>
          {canWrite && plan.status === 'planned' && (
            <button
              type="button"
              aria-label={t('panel.removeNamed', { name: plan.name })}
              onClick={() => {
                actions.removePlan(plan.id);
              }}
              className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-medium text-danger hover:underline"
            >
              {t('panel.remove')}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
