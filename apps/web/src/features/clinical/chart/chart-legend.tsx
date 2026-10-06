import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PLANNED_SHADOW } from './glyph-style';
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
 * The chart legend (spec §Interactions → Legend), in two labelled groups: what the tooth's fill
 * says (its treatment), then the markers layered on top, each in precedence order. Simple mode
 * collapses "Treated surface" and "Whole tooth" into "Treated"; outside a visit "Treated today" is
 * left out. It is the same for the primary and the permanent chart, so switching between them
 * moves nothing. Every item is one fixed height, so both groups are too. Wraps and aligns to the
 * inline end.
 */
export function ChartLegend({
  showToday = true,
}: {
  /** "Treated today" means nothing outside a visit (the record's chart tab, 4b D17). */
  showToday?: boolean;
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

  return (
    <div className="flex flex-wrap justify-end gap-3">
      {group(t('legend.treatment'), fills)}
      {group(t('legend.markers'), markers)}
    </div>
  );
}
