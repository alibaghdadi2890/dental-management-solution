import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PLANNED_SHADOW } from './glyph-style';
import { AbsentBox } from './presence-glyph';
import { IMPLANT_OUTLINE } from './presence-style';
import { useChartSettings } from './use-chart-settings';

interface LegendItem {
  label: string;
  swatch: ReactNode;
}

const square = 'size-[11px] flex-none rounded-[2px] border';

/** The planned swatch's ring, with a margin as wide as the ring so it never draws over the label
 * or the next item. */
const PLANNED_RING = cn(PLANNED_SHADOW, 'm-[1.5px]');

/** A 3×3 mini glyph (5 cells) for the surface legend: `filled` picks which cells are tinted. */
function MiniGlyph({ filled }: { filled: 'centre' | 'all' }) {
  return (
    <span
      aria-hidden
      className="grid flex-none grid-cols-[repeat(3,3px)] grid-rows-[repeat(3,3px)] gap-px"
    >
      {[false, true, false, true, true, true, false, true, false].map((isSurface, index) => {
        const tinted = filled === 'all' ? isSurface : index === 4;
        return (
          <span
            key={index}
            className={cn(
              isSurface && 'rounded-[1px]',
              isSurface && (tinted ? 'bg-primary-tint-strong' : 'bg-border-control'),
            )}
          />
        );
      })}
    </span>
  );
}

/**
 * The chart legend (spec §Interactions → Legend), in labelled groups: what the tooth's fill
 * says (its treatment), the markers layered on top, each in precedence order, then what is at
 * the position when it is not a plain natural tooth: missing, not erupted, implant (feature 7). Simple mode
 * collapses "Treated surface" and "Whole tooth" into "Treated"; outside a visit "Treated today" is
 * left out. It is the same for the primary and the permanent chart, so switching between them
 * moves nothing. Every item is one fixed height, so both groups are too. Wraps and aligns to the
 * inline end.
 *
 * `layout="key"` is the expanded chart's legend, where there is room to read it like a map key:
 * each group is a titled list, one item to a line, its swatch in a column of its own. The groups
 * stand side by side under the chart, and stack into a rail beside it once the chart card's
 * `@container/chart` is wide enough for both.
 */
export function ChartLegend({
  showToday = true,
  layout = 'inline',
}: {
  /** "Treated today" means nothing outside a visit (the record's chart tab, 4b D17). */
  showToday?: boolean;
  layout?: 'inline' | 'key';
}) {
  const { t } = useTranslation('clinical');
  const { mode } = useChartSettings();

  const treatedToday: LegendItem = {
    label: t('legend.treatedToday'),
    swatch: <span className={cn(square, 'border-primary bg-primary')} />,
  };
  const treatment: LegendItem[] =
    mode === 'surface'
      ? [
          { label: t('legend.treatedSurface'), swatch: <MiniGlyph filled="centre" /> },
          { label: t('legend.wholeTooth'), swatch: <MiniGlyph filled="all" /> },
          treatedToday,
        ]
      : [
          {
            label: t('legend.treated'),
            swatch: (
              <span className={cn(square, 'border-primary-tint-strong bg-primary-tint-border')} />
            ),
          },
          treatedToday,
        ];

  const fills = showToday ? treatment : treatment.filter((item) => item !== treatedToday);
  const markers: LegendItem[] = [
    {
      label: t('legend.diagnosis'),
      swatch: <span className="mx-[1.5px] size-2 flex-none rounded-full bg-danger" />,
    },
    {
      label: t('legend.planned'),
      swatch: <span className={cn(square, 'border-planned-border bg-planned-bg', PLANNED_RING)} />,
    },
    {
      label: t('legend.inProgress'),
      swatch: <span className={cn(square, 'border-warning bg-warning-border')} />,
    },
  ];

  // What is at a position (feature 7, H1), drawn as on the chart: outline style, cross and
  // second outline, none of which needs colour to be told apart.
  const absent = (presence: 'missing' | 'not_erupted') => (
    <span aria-hidden className="flex-none">
      <AbsentBox presence={presence} width={11} height={11} radius={2} mark="none" />
    </span>
  );
  const presence: LegendItem[] = [
    { label: t('legend.missing'), swatch: absent('missing') },
    { label: t('legend.notErupted'), swatch: absent('not_erupted') },
    {
      label: t('legend.implant'),
      swatch: (
        <span
          aria-hidden
          className={cn(
            'mx-[3px] size-[7px] flex-none rounded-[1.5px] border border-border-control bg-surface',
            IMPLANT_OUTLINE,
          )}
        />
      ),
    },
  ];

  const group = (title: string, items: LegendItem[]) => (
    <div className="inline-flex flex-wrap items-center gap-[9px] rounded-[7px] border border-inner-divider bg-faint px-[9px] py-1">
      <span className="text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase">
        {title}
      </span>
      {items.map((item) => (
        <span
          key={item.label}
          data-legend-item
          className="inline-flex h-[15px] items-center gap-[5px] text-[12.5px] leading-none whitespace-nowrap text-ink-secondary"
        >
          {item.swatch}
          {item.label}
        </span>
      ))}
    </div>
  );

  const keyGroup = (title: string, items: LegendItem[]) => (
    <div role="group" aria-label={title} className="min-w-[148px]">
      <p className="m-0 mb-2 text-[12.5px] leading-none font-semibold text-ink">{title}</p>
      <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
        {items.map((item) => (
          <li
            key={item.label}
            data-legend-item
            className="flex h-[18px] items-center gap-2 text-[13px] leading-none whitespace-nowrap text-ink-secondary"
          >
            <span className="grid w-[18px] flex-none place-items-center">{item.swatch}</span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );

  if (layout === 'key') {
    return (
      <div
        data-legend-key
        className="flex flex-wrap gap-x-10 gap-y-5 @min-[1080px]/chart:flex-col @min-[1080px]/chart:flex-nowrap"
      >
        {keyGroup(t('legend.treatment'), fills)}
        {keyGroup(t('legend.markers'), markers)}
        {keyGroup(t('legend.presence'), presence)}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-3">
      {group(t('legend.treatment'), fills)}
      {group(t('legend.markers'), markers)}
      {group(t('legend.presence'), presence)}
    </div>
  );
}
