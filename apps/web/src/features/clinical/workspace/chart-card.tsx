import type { DentitionStage, Patient, ToothCode, ToothState } from '@dcm/contracts';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartLegend } from '../chart/chart-legend';
import { DentalChart } from '../chart/dental-chart';
import { DentitionSelect } from './dentition-select';
import { type ChartArea, useToothSelection } from './tooth-selection';

/** The chart card's frame (spec §Visit Workspace → Body 1): white, 10px radius, 18/18/16px
 * padding, the 600/14px "Dental chart" title with its subtitle (the chart toggle) beside it, and
 * the aside (the legend). The
 * aside is sized by its content: beside the title while it fits there on one line, else on its
 * own full-width row; either way it fills the rest of its row, so an end-aligned legend always
 * ends at the card's inline end. */
export function ChartCardFrame({
  aside,
  subtitle,
  children,
}: {
  aside?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('clinical');
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 rounded-xl border border-border bg-surface px-[18px] pt-[18px] pb-4"
    >
      <div className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
            {t('chartCard.title')}
          </h2>
          {subtitle}
        </div>
        {aside && <div className="min-w-0 flex-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * The workspace's dental chart card: the title, the chart toggle, the legend, then the full
 * chart at 12px cells with its jaw bars and Whole mouth pill, drawn from `teeth` (the patient's records plus this
 * visit's services, derived by the page). Clicking a tooth, a jaw or Whole mouth selects it
 * (`useToothSelection`), which clears the pending surfaces. Whatever changes the selection (a click, the arrows, the
 * panel's succession link), the selected tooth is scrolled into view in the horizontally
 * scrolling arch, and focus follows it when it was already in the chart (the arrows walk the
 * teeth with focus).
 */
export function ChartCard({
  teeth,
  patient,
  stage,
  onStageChange,
  canWrite,
  showToday = true,
  areaCounts,
}: {
  teeth: ReadonlyMap<ToothCode, ToothState>;
  patient: Patient;
  /** The chart on screen, primary or permanent, and the toggle's switch to the other. */
  stage: DentitionStage;
  onStageChange: (stage: DentitionStage) => void;
  /** `visit:write`: the switch is remembered on the patient. */
  canWrite: boolean;
  /** "Treated today" means nothing outside a visit. */
  showToday?: boolean;
  /** Today's services per jaw and for the whole mouth (the visit workspace). */
  areaCounts?: Partial<Record<ChartArea, number>>;
}) {
  const selection = useToothSelection();
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = chartRef.current;
    const button = container?.querySelector<HTMLElement>('button[aria-pressed="true"]');
    if (!container || !button) return;
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (container.contains(document.activeElement) && document.activeElement !== button) {
      button.focus();
    }
  }, [selection.tooth]);

  return (
    <ChartCardFrame
      subtitle={
        <DentitionSelect
          patient={patient}
          stage={stage}
          canWrite={canWrite}
          onChange={(next) => {
            // The chart follows a selected tooth, so the switch lets go of it.
            selection.select(null);
            onStageChange(next);
          }}
        />
      }
      aside={<ChartLegend showToday={showToday} />}
    >
      <div ref={chartRef}>
        <DentalChart
          teeth={teeth}
          dentition={stage}
          size={12}
          selected={selection.tooth}
          onToothClick={selection.select}
          area={selection.area}
          onAreaClick={selection.selectArea}
          {...(areaCounts && { areaCounts })}
        />
      </div>
    </ChartCardFrame>
  );
}
