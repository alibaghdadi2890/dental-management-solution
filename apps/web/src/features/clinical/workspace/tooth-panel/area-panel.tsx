import { isOpenPlan } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLevelLabel } from '../../chart/use-chart-settings';
import { CHART_AREAS, type ChartArea, useToothSelection } from '../tooth-selection';
import { CompletedSection } from './completed-section';
import { PlanSection } from './plan-section';
import type { ToothPanelProps } from './tooth-panel';

type SectionKey = 'diagnosis' | 'plan' | 'completed';

/** A record that isn't on a tooth belongs to its jaw, or to the whole mouth without one. */
const inArea = (record: { toothCode: unknown; jaw: 'upper' | 'lower' | null }, area: ChartArea) =>
  record.toothCode === null && (record.jaw ?? 'mouth') === area;

/**
 * The panel of a selected jaw or of the whole mouth: the level's name, the three levels as tabs
 * (the same selection the chart's bars and pill make), then its treatment plan and its treatment —
 * this visit's services with their prices, and what earlier visits did. The stages are the tooth
 * panel's own, so they act and gate the same way; a diagnosis is always on a tooth, so there is
 * none here.
 */
export function AreaPanel({
  area,
  visit,
  chart,
  canWrite,
  timeZone,
  onOpenDrawer,
  sections,
}: Pick<ToothPanelProps, 'visit' | 'chart' | 'canWrite' | 'timeZone' | 'onOpenDrawer'> & {
  area: ChartArea;
  sections: { isOpen: (key: SectionKey) => boolean; toggle: (key: SectionKey) => () => void };
}) {
  const { t } = useTranslation('clinical');
  const levelLabel = useLevelLabel();
  const { selectArea } = useToothSelection();
  const labelOf = (level: ChartArea) => levelLabel(level === 'mouth' ? null : level);
  const plans = chart.plans.filter((plan) => inArea(plan, area));
  const services = (visit?.services ?? []).filter((service) => inArea(service, area));
  const history = chart.history.filter((line) => inArea(line, area));

  return (
    <>
      <div className="border-b border-inner-divider bg-sunken px-4 py-[15px]">
        <h2 className="m-0 mb-3 text-[20px] leading-none font-bold tracking-[-0.02em]">
          {labelOf(area)}
        </h2>
        <div
          role="group"
          aria-label={t('panel.levels')}
          className="flex gap-0.5 rounded-lg border border-border bg-subtle p-0.5"
        >
          {CHART_AREAS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={level === area}
              onClick={() => {
                selectArea(level);
              }}
              className={cn(
                'h-8 min-w-0 flex-1 cursor-pointer rounded-md border-0 px-2 text-[12.5px] leading-none font-medium',
                level === area
                  ? 'bg-surface font-semibold text-primary shadow-[0_1px_2px_rgba(27,26,31,.08)]'
                  : 'bg-transparent text-ink-secondary hover:text-ink',
              )}
            >
              {labelOf(level)}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-[15px]">
        <PlanSection
          plans={plans.filter((plan) => isOpenPlan(plan) || plan.status === 'performed')}
          diagnoses={chart.diagnoses}
          timeZone={timeZone}
          canWrite={canWrite}
          open={sections.isOpen('plan')}
          onToggle={sections.toggle('plan')}
          onAdd={() => {
            onOpenDrawer('plan');
          }}
        />
        <CompletedSection
          code={null}
          services={services}
          unfinished={plans.filter((plan) => plan.status === 'in_progress')}
          history={history}
          canWrite={canWrite && visit !== null}
          canWriteUnfinished={canWrite}
          open={sections.isOpen('completed')}
          onToggle={sections.toggle('completed')}
          onAdd={() => {
            onOpenDrawer('service');
          }}
        />
      </div>
    </>
  );
}
