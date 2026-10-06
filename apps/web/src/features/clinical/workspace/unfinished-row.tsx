import type { TreatmentPlan } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '@/components/ui/menu';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLevelLabel, useToothLabel } from '../chart/use-chart-settings';
import { useChartingActions } from './charting-actions';
import { RowMenu } from './row-menu';
import { Badge } from './tooth-panel/panel-section';
import { SurfaceTag } from './tooth-panel/surface-tag';
import { useCancelPlan } from './tooth-panel/use-cancel-plan';
import { useToothSelection } from './tooth-selection';
import { type UnfinishedAction, unfinishedActions } from './unfinished';

type MenuAction = Exclude<UnfinishedAction, 'complete'>;

/**
 * One unfinished service (ADR-0032): added in an earlier visit, or this one, and charged only by
 * the visit that completes it. Amber, with the "Not finished" badge, when it started, how many
 * visits have worked on it and its price. **Complete** shows on the row in the visit that worked
 * on it; the three-dot menu holds the rest (`unfinishedActions`). `target` adds the tooth or
 * level, as a link that selects it, for lists that are not about one target. Read-only without
 * the scope's write permission.
 */
export function UnfinishedRow({
  plan,
  canWrite,
  target = false,
  className,
}: {
  plan: TreatmentPlan;
  canWrite: boolean;
  target?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const cancel = useCancelPlan();
  const { select, selectArea } = useToothSelection();
  const toothLabel = useToothLabel();
  const levelLabel = useLevelLabel();
  const { toothCode } = plan;
  const [first] = plan.sessions;
  const offered = canWrite ? unfinishedActions(plan, actions.scope) : [];
  const menu = offered.filter((action): action is MenuAction => action !== 'complete');
  const run: Record<MenuAction, () => void> = {
    continue: () => {
      actions.continuePlan(plan);
    },
    notToday: () => {
      actions.undoSession(plan);
    },
    remove: () => {
      actions.removeUnfinished(plan);
    },
    cancel: () => {
      cancel(plan);
    },
  };

  return (
    <div
      data-unfinished={plan.id}
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-warning-bg', className)}
    >
      {target && (
        <button
          type="button"
          dir={toothCode === null ? undefined : 'ltr'}
          onClick={() => {
            if (toothCode === null) selectArea(plan.jaw ?? 'mouth');
            else select(toothCode);
          }}
          className="min-w-[72px] flex-none cursor-pointer border-0 bg-transparent p-0 text-start font-mono text-[13px] leading-none font-semibold text-primary hover:underline"
        >
          {toothCode === null ? levelLabel(plan.jaw) : toothLabel(toothCode)}
        </button>
      )}
      <span className="min-w-0 flex-[1_1_140px]">
        <span className="block text-[13px] leading-[1.35] font-semibold">
          {plan.name}
          <SurfaceTag surfaces={plan.surfaces} className="ms-[7px] text-warning" />
        </span>
        <span className="block text-[12.5px] leading-[1.4] text-ink-muted">
          {[
            first && t('unfinished.started', { date: formatCalendarDate(first.date, locale) }),
            t('unfinished.visits', { count: plan.sessions.length }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <Badge tone="warning">{t('unfinished.badge')}</Badge>
      <span
        dir="ltr"
        className="font-mono text-[13px] leading-none font-medium text-ink-muted tabular-nums"
      >
        {formatMoney(plan.price, locale)}
      </span>
      {offered.includes('complete') && (
        <button
          type="button"
          aria-label={t('unfinished.completeNamed', { name: plan.name })}
          onClick={() => {
            actions.performPlan(plan);
          }}
          className="h-7 flex-none cursor-pointer rounded-md border-0 bg-primary px-[11px] text-[12.5px] leading-none font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          {t('unfinished.complete')}
        </button>
      )}
      {menu.length > 0 && (
        <RowMenu name={plan.name}>
          {menu.map((action) => (
            <MenuItem
              key={action}
              {...((action === 'remove' || action === 'cancel') && { tone: 'danger' as const })}
              onSelect={run[action]}
            >
              {t(`unfinished.${action}`)}
            </MenuItem>
          ))}
        </RowMenu>
      )}
    </div>
  );
}
