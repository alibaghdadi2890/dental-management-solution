import type { DentitionStage, Patient, ToothCode, ToothState } from '@dcm/contracts';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChartLegend } from '../chart/chart-legend';
import { DentalChart } from '../chart/dental-chart';
import { FittedChart } from '../chart/fitted-chart';
import { DentitionSelect } from './dentition-select';
import { type ChartArea, useToothSelection } from './tooth-selection';
import type { ChartExpansion } from './use-chart-expansion';

/** Four corners pulling apart (expand) or drawing together (collapse), in the text colour. */
function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {expanded ? (
        <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
      ) : (
        <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
      )}
    </svg>
  );
}

/** The chart card's frame (spec §Visit Workspace → Body 1): white, 10px radius, 18/18/16px
 * padding, the 600/14px "Dental chart" title with its subtitle (the chart toggle) beside it, and
 * the aside (the legend). The
 * aside is sized by its content: beside the title while it fits there on one line, else on its
 * own full-width row; either way it fills the rest of its row, so an end-aligned legend always
 * ends at the card's inline end.
 *
 * With `expansion` the card has an expand button in its top inline-end corner. Expanded, the
 * header keeps only the title row and the legend leaves it for `expandedAside`: under the chart,
 * or in a rail beside it once the card (`@container/chart`) is wide enough for both. The page
 * decides how much room an expanded card gets; the card only rearranges itself. */
export function ChartCardFrame({
  aside,
  expandedAside,
  subtitle,
  action,
  expansion,
  children,
}: {
  aside?: ReactNode;
  /** The legend of the expanded card (`ChartLegend`'s key layout). */
  expandedAside?: ReactNode;
  subtitle?: ReactNode;
  /** A button beside the chart toggle (the record's Edit presence). */
  action?: ReactNode;
  expansion?: ChartExpansion | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation('clinical');
  const titleId = useId();
  const expanded = expansion?.expanded ?? false;
  const consumeToggle = expansion?.consumeToggle;
  const toggleRef = useRef<HTMLButtonElement>(null);
  // The card a toggle produced (a page may draw a new one on another row) takes the focus the
  // toggle had and comes into view.
  useEffect(() => {
    const button = toggleRef.current;
    if (!button || !consumeToggle?.()) return;
    button.focus({ preventScroll: true });
    button.closest('section')?.scrollIntoView({ block: 'nearest' });
  }, [expanded, consumeToggle]);
  const toggleLabel = t(expanded ? 'chartCard.collapse' : 'chartCard.expand');
  return (
    <section
      aria-labelledby={titleId}
      data-expanded={expanded || undefined}
      className="@container/chart relative mb-4 rounded-xl border border-border bg-surface px-[18px] pt-[18px] pb-4"
    >
      {expansion && (
        <IconButton
          ref={toggleRef}
          aria-label={toggleLabel}
          aria-pressed={expanded}
          title={toggleLabel}
          onClick={expansion.toggle}
          className={cn(
            'absolute end-[11px] top-[11px]',
            expanded && 'border-primary-tint-border bg-primary-tint text-primary',
          )}
        >
          <ExpandIcon expanded={expanded} />
        </IconButton>
      )}
      <div
        className={cn(
          'mb-4 flex flex-wrap items-start gap-x-4 gap-y-3',
          // Clear of the expand button in the corner.
          expansion && 'pe-9',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
            {t('chartCard.title')}
          </h2>
          {subtitle}
          {action}
        </div>
        {aside && !expanded && <div className="min-w-0 flex-auto">{aside}</div>}
      </div>
      {expanded ? (
        <div className="grid items-center gap-x-7 gap-y-5 pt-1 pb-2 @min-[1080px]/chart:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">{children}</div>
          {expandedAside && (
            <div className="border-t border-inner-divider pt-4 @min-[1080px]/chart:border-s @min-[1080px]/chart:border-t-0 @min-[1080px]/chart:ps-7 @min-[1080px]/chart:pt-0">
              {expandedAside}
            </div>
          )}
        </div>
      ) : (
        children
      )}
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
 * teeth with focus). With `expansion` the card can be expanded: the chart is then drawn at the
 * largest cell that fits the card, and the legend becomes a key beside or under it.
 */
export function ChartCard({
  teeth,
  patient,
  stage,
  onStageChange,
  canWrite,
  showToday = true,
  areaCounts,
  action,
  footer,
  onMark,
  expansion,
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
  /** A button in the card's header, and what sits under the chart (Edit presence's toolbar). */
  action?: ReactNode;
  footer?: ReactNode;
  /** Marking mode (Edit presence): a click on a tooth marks it instead of selecting it, and
   * the jaws and the whole mouth are not selectable. */
  onMark?: ((code: ToothCode) => void) | undefined;
  /** Lets the card be expanded across the page (`useChartExpansion`). */
  expansion?: ChartExpansion | undefined;
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
      action={action}
      aside={<ChartLegend showToday={showToday} />}
      expandedAside={<ChartLegend showToday={showToday} layout="key" />}
      expansion={expansion}
    >
      <div ref={chartRef}>
        <FittedChart expanded={expansion?.expanded ?? false} dentition={stage} withAreas={!onMark}>
          {(size) =>
            onMark ? (
              <DentalChart teeth={teeth} dentition={stage} size={size} onToothClick={onMark} />
            ) : (
              <DentalChart
                teeth={teeth}
                dentition={stage}
                size={size}
                selected={selection.tooth}
                onToothClick={selection.select}
                area={selection.area}
                onAreaClick={selection.selectArea}
                {...(areaCounts && { areaCounts })}
              />
            )
          }
        </FittedChart>
      </div>
      {footer}
    </ChartCardFrame>
  );
}
