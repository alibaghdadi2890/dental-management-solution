import {
  archColumns,
  type DentitionStage,
  presentTooth,
  type ToothCode,
  type ToothState,
} from '@dcm/contracts';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { IN_PROGRESS_SHADOW, PLANNED_SHADOW } from './glyph-style';
import { LEGEND_GROUP_LIMIT, type LegendEntry, legendGroups } from './legend-items';
import { MarkChip } from './mark-chip';
import { AbsentBox } from './presence-glyph';
import { IMPLANT_OUTLINE } from './presence-style';
import type { ChartHighlight } from './tooth-render';
import { useChartSettings } from './use-chart-settings';
import { useChartView } from './use-chart-view';

interface StaticItem {
  label: string;
  swatch: ReactNode;
}

const square = 'size-[11px] flex-none rounded-[2px] border';

/** A ring swatch, with a margin as wide as the ring so it never draws over the label or the
 * next item. */
const ringed = (shadow: string) => cn(shadow, 'm-[2px]');

/**
 * The chart legend (feature 9, M11). It is about this patient: first the **diagnoses** and the
 * **services** that are on the chart on screen, in the current view, each with its chip, its name
 * and how many teeth carry it; then what never changes — **Status** (how today's work, earlier
 * work, work not finished and planned work are told apart, whatever the colour) and **Tooth**
 * (missing, not erupted, implant). A dynamic group with nothing in it is left out; one with more
 * than eight lines shows eight and "+N more", which opens in place.
 *
 * A dynamic line is a button: pressing it highlights its teeth on the chart (`onHighlight`),
 * pressing it again clears that. Without `onHighlight` the lines are plain text.
 *
 * `layout="key"` is the expanded chart's legend, where there is room to read it like a map key:
 * each group is a titled list, one item to a line. The groups stand side by side under the chart,
 * and stack into a rail beside it once the chart card's `@container/chart` is wide enough.
 */
export function ChartLegend({
  teeth,
  dentition,
  showToday = true,
  layout = 'inline',
  highlight = null,
  onHighlight,
}: {
  /** The chart's derived teeth, and which of the patient's two charts is on screen. */
  teeth: ReadonlyMap<ToothCode, ToothState>;
  dentition: DentitionStage;
  /** "Today" means nothing outside a visit (the record's chart tab, 4b D17). */
  showToday?: boolean;
  layout?: 'inline' | 'key';
  highlight?: ChartHighlight | null;
  onHighlight?: ((item: ChartHighlight) => void) | undefined;
}) {
  const { t } = useTranslation('clinical');
  const { orientation } = useChartSettings();
  const [view] = useChartView();
  const [expanded, setExpanded] = useState<ReadonlySet<LegendEntry['kind']>>(new Set());

  const groups = useMemo(() => {
    const { upper, lower } = archColumns(orientation, dentition);
    const codes = [...upper, ...lower].map((column) => presentTooth(column, dentition).code);
    return legendGroups(teeth, view, codes);
  }, [teeth, view, orientation, dentition]);

  const isKey = layout === 'key';
  const itemClass = isKey
    ? 'flex h-[18px] items-center gap-2 text-[13px] leading-none whitespace-nowrap text-ink-secondary'
    : 'inline-flex h-[15px] items-center gap-[5px] text-[12.5px] leading-none whitespace-nowrap text-ink-secondary';
  const swatchBox = (swatch: ReactNode) =>
    isKey ? <span className="grid w-[18px] flex-none place-items-center">{swatch}</span> : swatch;

  const entryLine = (entry: LegendEntry) => {
    const pressed = highlight?.kind === entry.kind && highlight.id === entry.id;
    const content = (
      <>
        {swatchBox(<MarkChip kind={entry.kind} color={entry.color} icon={entry.icon} size={13} />)}
        <span>{entry.name}</span>{' '}
        <span className="text-ink-muted">{t('legend.teeth', { count: entry.teeth })}</span>
      </>
    );
    if (!onHighlight) {
      return (
        <span data-legend-item={`${entry.kind}:${entry.id}`} className={itemClass}>
          {content}
        </span>
      );
    }
    return (
      <button
        type="button"
        data-legend-item={`${entry.kind}:${entry.id}`}
        aria-pressed={pressed}
        title={t(pressed ? 'legend.clearHighlight' : 'legend.highlight', { name: entry.name })}
        onClick={() => {
          onHighlight({ kind: entry.kind, id: entry.id });
        }}
        className={cn(
          itemClass,
          'cursor-pointer rounded-[5px] border-0 bg-transparent p-0 outline-offset-2 hover:text-ink',
          pressed && 'font-semibold text-ink underline decoration-primary underline-offset-[3px]',
        )}
      >
        {content}
      </button>
    );
  };

  const dynamic = (kind: LegendEntry['kind'], entries: readonly LegendEntry[]) => {
    const open = expanded.has(kind);
    const shown = open ? entries : entries.slice(0, LEGEND_GROUP_LIMIT);
    const more = entries.length - shown.length;
    return [
      ...shown.map((entry) => ({ key: entry.id, node: entryLine(entry) })),
      ...(more > 0
        ? [
            {
              key: 'more',
              node: (
                <button
                  type="button"
                  data-legend-more
                  aria-expanded={false}
                  onClick={() => {
                    setExpanded((current) => new Set([...current, kind]));
                  }}
                  className={cn(
                    itemClass,
                    'cursor-pointer border-0 bg-transparent p-0 font-medium text-primary',
                  )}
                >
                  {t('legend.more', { count: more })}
                </button>
              ),
            },
          ]
        : []),
    ];
  };

  const fixed = (items: readonly StaticItem[]) =>
    items.map((item) => ({
      key: item.label,
      node: (
        <span data-legend-item className={itemClass}>
          {swatchBox(item.swatch)}
          {item.label}
        </span>
      ),
    }));

  // Status is the second cue (M2), shown on a neutral swatch: it holds for every colour.
  const status: StaticItem[] = [
    ...(showToday && view !== 'diagnoses'
      ? [
          {
            label: t('legend.today'),
            swatch: <span className={cn(square, 'border-[1.5px] border-ink bg-ink-muted')} />,
          },
        ]
      : []),
    ...(view !== 'diagnoses'
      ? [
          {
            label: t('legend.past'),
            swatch: <span className={cn(square, 'border-border-control bg-border-strong')} />,
          },
        ]
      : []),
    {
      label: t('legend.inProgress'),
      swatch: (
        <span
          className={cn(square, 'border-border-control bg-surface', ringed(IN_PROGRESS_SHADOW))}
        />
      ),
    },
    {
      label: t('legend.planned'),
      swatch: (
        <span
          className={cn(square, 'border-planned-border bg-planned-bg', ringed(PLANNED_SHADOW))}
        />
      ),
    },
  ];

  // What is at a position (feature 7, H1), drawn as on the chart: outline style, cross and
  // second outline, none of which needs colour to be told apart.
  const absent = (presence: 'missing' | 'not_erupted') => (
    <span aria-hidden className="flex-none">
      <AbsentBox presence={presence} width={11} height={11} radius={2} />
    </span>
  );
  const presence: StaticItem[] = [
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

  const sections = [
    { title: t('legend.diagnosesOnChart'), items: dynamic('diagnosis', groups.diagnoses) },
    { title: t('legend.servicesOnChart'), items: dynamic('service', groups.services) },
    { title: t('legend.status'), items: fixed(status) },
    { title: t('legend.presence'), items: fixed(presence) },
  ].filter((section) => section.items.length > 0);

  if (isKey) {
    return (
      <div
        data-legend-key
        className="flex flex-wrap gap-x-10 gap-y-5 @min-[1080px]/chart:flex-col @min-[1080px]/chart:flex-nowrap"
      >
        {sections.map((section) => (
          <div
            key={section.title}
            role="group"
            aria-label={section.title}
            className="min-w-[148px]"
          >
            <p className="m-0 mb-2 text-[12.5px] leading-none font-semibold text-ink">
              {section.title}
            </p>
            <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
              {section.items.map((item) => (
                <li key={item.key}>{item.node}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-3">
      {sections.map((section) => (
        <div
          key={section.title}
          role="group"
          aria-label={section.title}
          className="inline-flex flex-wrap items-center gap-x-[11px] gap-y-[7px] rounded-[7px] border border-inner-divider bg-faint px-[9px] py-[5px]"
        >
          <span className="text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase">
            {section.title}
          </span>
          {section.items.map((item) => (
            <span key={item.key} className="inline-flex">
              {item.node}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
