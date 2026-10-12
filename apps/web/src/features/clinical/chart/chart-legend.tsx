import {
  archColumns,
  type DentitionStage,
  presentTooth,
  type ToothCode,
  type ToothState,
} from '@dcm/contracts';
import { type ReactNode, useId, useMemo, useState } from 'react';
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
 * The chart legend (feature 9, M11). It holds two different things and keeps them apart.
 *
 * **What is on this chart** is about this patient and changes with every record: the
 * **diagnoses** and the **services** on the chart on screen, in the current view, each with its
 * chip, its name and how many teeth carry it. A group with nothing in it is left out; one with
 * more than eight lines shows eight and "+N more", which opens in place. A line is a button:
 * pressing it highlights its teeth on the chart (`onHighlight`), pressing it again clears that.
 * Without `onHighlight` the lines are plain text.
 *
 * **The key** never changes: **Status** (how today's work, earlier work, work not finished and
 * planned work are told apart, whatever the colour) and **Tooth** (missing, not erupted,
 * implant). It is learned once, and every tooth says the same in its tooltip.
 *
 * `layout="inline"` is one band under the card's header: what is on the chart as a row of
 * chips, read from the start edge, and a **Key** button at its end that opens the key under
 * the row. The key starts closed, so the band is as long as the patient's chart is busy and no
 * longer.
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
  const [keyOpen, setKeyOpen] = useState(false);
  const keyId = useId();

  const groups = useMemo(() => {
    const { upper, lower } = archColumns(orientation, dentition);
    const codes = [...upper, ...lower].map((column) => presentTooth(column, dentition).code);
    return legendGroups(teeth, view, codes);
  }, [teeth, view, orientation, dentition]);

  const isKey = layout === 'key';
  const itemClass = isKey
    ? 'flex h-[18px] items-center gap-2 text-[13px] leading-none whitespace-nowrap text-ink-secondary'
    : 'inline-flex h-6 items-center gap-[5px] text-[12.5px] leading-none whitespace-nowrap text-ink-secondary';
  const swatchBox = (swatch: ReactNode) =>
    isKey ? <span className="grid w-[18px] flex-none place-items-center">{swatch}</span> : swatch;

  /** A line of the inline band: a chip of its own, with the tooth count as a bare number. */
  const entryChip = (entry: LegendEntry) => {
    const pressed = highlight?.kind === entry.kind && highlight.id === entry.id;
    const said = `${entry.name} ${t('legend.teeth', { count: entry.teeth })}`;
    const chip =
      'inline-flex h-6 max-w-[220px] flex-none items-center gap-1.5 rounded-full border px-2 text-[12.5px] leading-none whitespace-nowrap';
    const content = (
      <>
        <MarkChip kind={entry.kind} color={entry.color} icon={entry.icon} size={12} />
        <span className="min-w-0 truncate">{entry.name}</span>
        <span className="font-mono text-[11.5px] text-ink-muted tabular-nums">{entry.teeth}</span>
      </>
    );
    if (!onHighlight) {
      return (
        <span
          data-legend-item={`${entry.kind}:${entry.id}`}
          title={said}
          className={cn(chip, 'border-inner-divider bg-surface text-ink-secondary')}
        >
          {content}
        </span>
      );
    }
    return (
      <button
        type="button"
        data-legend-item={`${entry.kind}:${entry.id}`}
        aria-pressed={pressed}
        aria-label={said}
        title={t(pressed ? 'legend.clearHighlight' : 'legend.highlight', { name: entry.name })}
        onClick={() => {
          onHighlight({ kind: entry.kind, id: entry.id });
        }}
        className={cn(
          chip,
          'cursor-pointer outline-offset-2',
          pressed
            ? 'border-primary bg-primary-tint font-semibold text-primary'
            : 'border-inner-divider bg-surface text-ink-secondary hover:border-border-strong hover:text-ink',
        )}
      >
        {content}
      </button>
    );
  };

  const entryLine = (entry: LegendEntry) => {
    if (!isKey) return entryChip(entry);
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
                    !isKey && 'h-6 px-1',
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

  const onChart = [
    {
      title: t('legend.diagnosesOnChart'),
      short: t('legend.diagnoses'),
      items: dynamic('diagnosis', groups.diagnoses),
    },
    {
      title: t('legend.servicesOnChart'),
      short: t('legend.services'),
      items: dynamic('service', groups.services),
    },
  ].filter((section) => section.items.length > 0);
  const key = [
    { title: t('legend.status'), items: fixed(status) },
    { title: t('legend.presence'), items: fixed(presence) },
  ];
  const sections = [...onChart, ...key];

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

  const groupLabel = 'flex-none text-[12px] leading-none font-medium text-ink-muted';
  return (
    <div data-legend-band className="rounded-lg border border-inner-divider bg-faint">
      <div className="flex items-start gap-3 px-2.5 py-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
          {onChart.length === 0 && (
            <span className="flex h-6 items-center text-[12.5px] leading-none text-ink-muted">
              {t('legend.nothing')}
            </span>
          )}
          {onChart.map((section) => (
            <div
              key={section.title}
              role="group"
              aria-label={section.title}
              className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1.5"
            >
              <span className={groupLabel}>{section.short}</span>
              {section.items.map((item) => (
                <span key={item.key} className="inline-flex min-w-0">
                  {item.node}
                </span>
              ))}
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={keyOpen}
          aria-controls={keyOpen ? keyId : undefined}
          onClick={() => {
            setKeyOpen((current) => !current);
          }}
          className={cn(
            'flex h-6 flex-none cursor-pointer items-center gap-1 rounded-md border px-2 text-[12px] leading-none font-medium',
            keyOpen
              ? 'border-primary-tint-border bg-primary-tint text-primary'
              : 'border-transparent bg-transparent text-ink-muted hover:border-inner-divider hover:bg-surface hover:text-ink',
          )}
        >
          {t('legend.key')}
          <svg
            aria-hidden
            width="9"
            height="9"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className={cn(keyOpen && 'rotate-180')}
          >
            <path d="m2 3.5 3 3 3-3" />
          </svg>
        </button>
      </div>
      {keyOpen && (
        <div
          id={keyId}
          data-legend-static
          className="flex flex-wrap gap-x-7 gap-y-2 border-t border-inner-divider px-2.5 py-2"
        >
          {key.map((section) => (
            <div
              key={section.title}
              role="group"
              aria-label={section.title}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
            >
              <span className={groupLabel}>{section.title}</span>
              {section.items.map((item) => (
                <span key={item.key} className="inline-flex">
                  {item.node}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
