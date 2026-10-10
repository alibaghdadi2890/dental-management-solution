import {
  type ChartMode,
  type ChartOrientation,
  markColorVars,
  surfaceCells,
  type ToothCode,
} from '@dcm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  CELL_MAP,
  CHART_GLYPH_GAP,
  CHART_GLYPH_PADDING,
  fillName,
  fillStyle,
  gridStyle,
  IN_PROGRESS_SHADOW,
  PLANNED_SHADOW,
  SELECTED_SHADOW,
  simpleBox,
} from './glyph-style';
import { MarkChip } from './mark-chip';
import { PanelGlyph, type PanelGlyphProps } from './panel-glyph';
import { AbsentBox, ImplantPost } from './presence-glyph';
import { IMPLANT_OUTLINE, isAbsent, rootSide } from './presence-style';
import type { BandItem, ToothRender } from './tooth-render';

interface GlyphBase {
  code: ToothCode;
  /** What to draw (`toToothRender`); the glyph works nothing out itself. */
  render: ToothRender;
  mode: ChartMode;
  orientation: ChartOrientation;
}

/** A tooth in the arch: 12 px cells on the full chart, 8 px on the compact one, other sizes for
 * previews. Not interactive itself — the chart's column is. */
interface ChartGlyphProps extends GlyphBase {
  variant: 'chart';
  size: number;
}

/** The tooth-history dialog's 15 px read-only glyph. */
interface HistoryGlyphProps extends GlyphBase {
  variant: 'history';
}

export type ToothGlyphProps =
  ChartGlyphProps | (PanelGlyphProps & { variant: 'panel' }) | HistoryGlyphProps;

const HISTORY_CELL = 15;

const RING = {
  selected: cn('rounded-[4px]', SELECTED_SHADOW),
  in_progress: cn('rounded-[4px]', IN_PROGRESS_SHADOW),
  planned: cn('rounded-[4px]', PLANNED_SHADOW),
} as const;

/**
 * A tooth glyph (feature 9): a renderer of `ToothRender`, with no derivation of its own. The
 * crown is a 3×3 grid of five surface cells, laid out anatomically by `surfaceCells` and never
 * mirrored, or in simple mode one whole-tooth body. Each cell or body is painted in the colour of
 * the catalog item `toToothRender` gave it, its tone saying when (`fillStyle`). The **band** sits
 * at the root end — above an upper tooth, below a lower one: up to three chips for the marks that
 * are on the whole tooth or did not fit the crown, then `+N`. One ring at most goes around the
 * glyph: selected, in progress or planned. The panel variant is `PanelGlyph`.
 *
 * A position that is not a plain natural tooth is drawn by its presence (feature 7, H1): a
 * missing or not-erupted one as a single outlined box where the crown would be, with no band; an
 * implant as the normal glyph inside a second outline with a post on its root side
 * (`presence-glyph.tsx`).
 */
export function ToothGlyph(props: ToothGlyphProps) {
  if (props.variant === 'panel') return <PanelGlyph {...props} />;
  if (props.variant === 'history') {
    return <GlyphFrame {...props} cell={HISTORY_CELL} gap={1.5} padding={0} />;
  }
  return (
    <GlyphFrame {...props} cell={props.size} gap={CHART_GLYPH_GAP} padding={CHART_GLYPH_PADDING} />
  );
}

/** The band: chips side by side from the inline start (so it mirrors in an RTL layout), sharing
 * the tooth's width when they would not fit at full size; on the compact chart, dots. */
function Band({
  items,
  overflow,
  compact,
  cell,
  gap,
  width,
  height,
}: {
  items: readonly BandItem[];
  overflow: number;
  compact: boolean;
  cell: number;
  gap: number;
  width: number;
  height: number;
}) {
  const { i18n } = useTranslation();
  if (compact) {
    const dot = Math.max(2, Math.round(cell * 0.4));
    return (
      <span
        data-band
        className="flex items-center justify-center"
        style={{ width, height, gap: Math.max(1, gap) }}
      >
        {items.map((item, index) => (
          <span
            key={index}
            data-band-dot={`${item.kind}:${item.code}`}
            className="flex-none rounded-full"
            style={{
              width: dot,
              height: dot,
              backgroundColor:
                item.color === null ? 'var(--color-border-strong)' : markColorVars(item.color).fill,
            }}
          />
        ))}
      </span>
    );
  }

  const chipHeight = Math.min(cell - 2, height);
  const fontSize = Math.max(7, Math.round(cell * 0.62));
  const plusWidth = overflow > 0 ? Math.ceil(fontSize * 1.25) : 0;
  const gaps = (items.length - 1 + (overflow > 0 ? 1 : 0)) * gap;
  const chipWidth =
    items.length === 0
      ? 0
      : Math.max(2, Math.min(chipHeight, Math.floor((width - plusWidth - gaps) / items.length)));
  return (
    <span data-band dir={i18n.dir()} className="flex items-center" style={{ width, height, gap }}>
      {items.map((item, index) => (
        <MarkChip
          key={index}
          data-chip={`${item.kind}:${item.code}`}
          kind={item.kind}
          color={item.color}
          icon={item.icon}
          tone={item.tone}
          size={chipHeight}
          width={chipWidth}
          ringed={item.ringed}
        />
      ))}
      {overflow > 0 && (
        <span
          data-band-overflow
          dir="ltr"
          className="flex-none text-center font-mono leading-none font-semibold text-ink-secondary"
          style={{ width: plusWidth, fontSize }}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

/** The read-only glyph shared by the chart and history variants: the crown and, on its root
 * side, the band. */
function GlyphFrame({
  code,
  render,
  mode,
  orientation,
  cell,
  gap,
  padding,
}: GlyphBase & { cell: number; gap: number; padding: number }) {
  const { presence, rings } = render;
  const ring = rings.selected
    ? 'selected'
    : rings.inProgress
      ? 'in_progress'
      : rings.planned
        ? 'planned'
        : undefined;
  const side = rootSide(code);
  const simple = simpleBox(cell);
  const crownSide = cell * 3 + gap * 2;
  const width = mode === 'simple' ? simple.width : crownSide;
  const bandHeight = mode === 'simple' ? simple.band - gap : cell;

  let crown: ReactNode;
  if (isAbsent(presence)) {
    crown = (
      <AbsentBox
        presence={presence}
        width={width}
        height={mode === 'simple' ? simple.height : crownSide}
        radius={mode === 'simple' ? simple.radius : Math.round(cell * 0.3)}
        planned={rings.planned || rings.inProgress}
        selected={rings.selected}
      />
    );
  } else if (mode === 'simple') {
    crown = (
      <span
        data-body
        data-fill={fillName(render.body ?? undefined)}
        data-ringed={render.body?.ringed || undefined}
        className={cn(
          'block border',
          render.body?.ringed && 'outline outline-[1.5px] outline-offset-1 outline-ink',
        )}
        style={{
          width: simple.width,
          height: simple.height,
          borderRadius: simple.radius,
          ...fillStyle(render.body ?? undefined, rings.selected),
        }}
      />
    );
  } else {
    const surfaces = surfaceCells(code, orientation);
    crown = (
      <span className="grid" style={gridStyle(cell, gap, 0)}>
        {CELL_MAP.map((index, position) => {
          if (index === null) return <span key={position} />;
          const surface = surfaces[index];
          const fill = render.cells[surface];
          return (
            <span
              key={position}
              data-surface={surface}
              data-fill={fillName(fill)}
              data-ringed={fill?.ringed || undefined}
              className={cn(
                'rounded-[1.5px] border',
                fill?.ringed && 'z-[1] outline outline-[1.5px] outline-ink',
              )}
              style={fillStyle(fill, rings.selected)}
            />
          );
        })}
      </span>
    );
  }

  // A missing or not-erupted position keeps the band's room, so every glyph is one size and
  // the arches stay aligned on the occlusal plane.
  const band = isAbsent(presence) ? (
    <span style={{ width, height: bandHeight }} />
  ) : (
    <Band
      items={render.band}
      overflow={render.bandOverflow}
      compact={render.compact}
      cell={cell}
      gap={gap}
      width={width}
      height={bandHeight}
    />
  );

  return (
    <span
      aria-hidden
      data-glyph
      data-ring={ring}
      data-presence={presence}
      data-band-count={render.band.length}
      data-faded={render.faded || undefined}
      className={cn(
        'relative flex flex-none flex-col transition-opacity',
        ring && RING[ring],
        presence === 'implant' && cn('rounded-[4px]', IMPLANT_OUTLINE),
        render.faded && 'opacity-35',
      )}
      style={{ gap, padding }}
    >
      {side === 'top' ? band : crown}
      {side === 'top' ? crown : band}
      {presence === 'implant' && <ImplantPost side={side} size={cell} />}
    </span>
  );
}
