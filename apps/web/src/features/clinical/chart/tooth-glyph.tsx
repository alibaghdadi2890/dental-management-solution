import {
  cellMark,
  type ChartMode,
  type ChartOrientation,
  type SurfaceKey,
  surfaceCells,
  type ToothCode,
  type ToothPresenceState,
  type ToothState,
  type ToothVisualState,
} from '@dcm/contracts';
import { cn } from '@/lib/utils';
import {
  CELL_MAP,
  CHART_GLYPH_GAP,
  CHART_GLYPH_PADDING,
  cellClass,
  gridStyle,
  PLANNED_SHADOW,
  SELECTED_SHADOW,
  simpleBox,
} from './glyph-style';
import { PanelGlyph, type PanelGlyphProps } from './panel-glyph';
import { AbsentBox, ImplantPost } from './presence-glyph';
import { IMPLANT_OUTLINE, isAbsent, rootSide } from './presence-style';

interface GlyphBase {
  code: ToothCode;
  /** Absent when nothing is recorded on the tooth. */
  tooth: ToothState | undefined;
  mode: ChartMode;
  orientation: ChartOrientation;
}

/** A tooth in the arch: 12 px cells on the full chart, 8 px on the compact one, other sizes for
 * previews. Not interactive itself — the chart's column is. */
interface ChartGlyphProps extends GlyphBase {
  variant: 'chart';
  size: number;
  selected?: boolean;
  /** What is at the position (feature 7): the tooth's own presence unless the chart overrides
   * it (a position its dentition has not reached). */
  presence?: ToothPresenceState;
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
  planned: cn('rounded-[4px]', PLANNED_SHADOW),
} as const;

interface Paint {
  mark: ToothVisualState;
  className: string;
}

/**
 * A tooth glyph (spec §Dental Chart → Construction, §Tooth states): in surface mode a 3×3 grid
 * whose five surface cells are coloured by `cellMark` (only treated surfaces fill; a whole-tooth
 * service fills every cell; an open plan washes the rest), laid out anatomically by
 * `surfaceCells` — never mirrored. In simple mode, one whole-tooth cell coloured by the tooth's
 * overall state. The planned and selected rings sit on the chart variant's box. The panel
 * variant is `PanelGlyph`.
 *
 * A position that is not a plain natural tooth is drawn by its presence (feature 7, H1): a
 * missing or not-erupted one as a single outlined box, an implant as the normal glyph inside a
 * second outline with a post on its root side (`presence-glyph.tsx`).
 */
export function ToothGlyph(props: ToothGlyphProps) {
  if (props.variant === 'panel') return <PanelGlyph {...props} />;
  if (props.variant === 'history') {
    const { tooth } = props;
    return (
      <GlyphGrid
        {...props}
        cell={HISTORY_CELL}
        gap={1.5}
        padding={0}
        presence={tooth?.presence ?? 'present'}
        planned={(tooth?.openPlanIds.length ?? 0) > 0}
        state={tooth?.state ?? 'none'}
        paint={(surface) => {
          const mark = surface ? cellMark(tooth, surface) : (tooth?.state ?? 'none');
          return { mark, className: cellClass(mark, false) };
        }}
      />
    );
  }
  return <ChartGlyph {...props} />;
}

function ChartGlyph({ tooth, size, selected = false, presence, ...rest }: ChartGlyphProps) {
  const ring = selected ? 'selected' : tooth?.state === 'planned' ? 'planned' : undefined;
  const planned = (tooth?.openPlanIds.length ?? 0) > 0;

  const paint = (surface: SurfaceKey | null): Paint => {
    if (!surface) {
      const mark = tooth?.state ?? 'none';
      return { mark, className: cellClass(mark, selected) };
    }
    const mark = cellMark(tooth, surface);
    return { mark, className: cellClass(mark, selected && tooth?.surfaces[surface] === undefined) };
  };

  return (
    <GlyphGrid
      {...rest}
      cell={size}
      gap={CHART_GLYPH_GAP}
      padding={CHART_GLYPH_PADDING}
      ring={ring}
      presence={presence ?? tooth?.presence ?? 'present'}
      planned={planned}
      selected={selected}
      state={tooth?.state ?? 'none'}
      paint={paint}
    />
  );
}

/** The read-only grid shared by the chart and history variants; `paint(null)` colours the single
 * simple-mode cell, `paint(surface)` each surface cell. A missing or not-erupted position is one
 * box of the same outer size instead; an implant is the grid with its outline and post. */
function GlyphGrid({
  code,
  mode,
  orientation,
  cell,
  gap,
  padding,
  ring,
  presence,
  planned,
  selected = false,
  state,
  paint,
}: Omit<GlyphBase, 'tooth'> & {
  cell: number;
  gap: number;
  padding: number;
  ring?: keyof typeof RING | undefined;
  presence: ToothPresenceState;
  planned: boolean;
  selected?: boolean;
  state: ToothVisualState;
  paint: (surface: SurfaceKey | null) => Paint;
}) {
  const implant = presence === 'implant';
  const boxClass = cn(
    'grid flex-none',
    ring && RING[ring],
    implant && cn('relative rounded-[4px]', IMPLANT_OUTLINE),
  );
  const post = implant && <ImplantPost side={rootSide(code)} size={cell} />;

  if (isAbsent(presence)) {
    const simple = simpleBox(cell);
    const side = cell * 3 + gap * 2;
    return (
      <span
        aria-hidden
        data-glyph
        data-ring={ring}
        data-presence={presence}
        className={cn('grid flex-none', ring && RING[ring])}
        style={{ padding }}
      >
        <AbsentBox
          presence={presence}
          width={mode === 'simple' ? simple.width : side}
          height={mode === 'simple' ? simple.height : side}
          radius={mode === 'simple' ? simple.radius : Math.round(cell * 0.3)}
          planned={planned}
          selected={selected}
          mark={state}
        />
      </span>
    );
  }

  if (mode === 'simple') {
    const box = simpleBox(cell);
    const { mark, className } = paint(null);
    return (
      <span
        aria-hidden
        data-glyph
        data-ring={ring}
        data-presence={presence}
        className={boxClass}
        style={{
          gridTemplateColumns: `${box.width}px`,
          gridTemplateRows: `${box.height}px`,
          padding,
        }}
      >
        <span data-mark={mark} className={className} style={{ borderRadius: box.radius }} />
        {post}
      </span>
    );
  }

  const surfaces = surfaceCells(code, orientation);
  return (
    <span
      aria-hidden
      data-glyph
      data-ring={ring}
      data-presence={presence}
      className={boxClass}
      style={gridStyle(cell, gap, padding)}
    >
      {CELL_MAP.map((index, position) => {
        if (index === null) return <span key={position} />;
        const surface = surfaces[index];
        const { mark, className } = paint(surface);
        return (
          <span
            key={position}
            data-surface={surface}
            data-mark={mark}
            className={cn(className, 'rounded-[1.5px]')}
          />
        );
      })}
      {post}
    </span>
  );
}
