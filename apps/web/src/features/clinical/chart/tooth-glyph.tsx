import {
  cellMark,
  type ChartMode,
  type ChartOrientation,
  isPrimary,
  type SurfaceKey,
  surfaceCells,
  type ToothCode,
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
  notErupted?: boolean;
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

/** Primary teeth draw at 0.78× (never under 6 px) so the dentition reads at a glance. */
function chartCellSize(code: ToothCode, size: number): number {
  return isPrimary(code) ? Math.max(6, Math.round(size * 0.78)) : size;
}

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
        paint={(surface) => {
          const mark = surface ? cellMark(tooth, surface) : (tooth?.state ?? 'none');
          return { mark, className: cellClass(mark, false) };
        }}
      />
    );
  }
  return <ChartGlyph {...props} />;
}

function ChartGlyph({
  tooth,
  size,
  selected = false,
  notErupted = false,
  ...rest
}: ChartGlyphProps) {
  const ring = selected ? 'selected' : tooth?.state === 'planned' ? 'planned' : undefined;
  const planned = (tooth?.openPlanIds.length ?? 0) > 0;

  const paint = (surface: SurfaceKey | null): Paint => {
    if (notErupted) {
      // Not yet through: a dashed outline, so it reads as a position rather than a tooth.
      return {
        mark: planned ? 'planned' : 'none',
        className: cn(
          'border border-dashed',
          planned ? 'bg-planned-bg' : 'bg-sunken',
          selected ? 'border-primary' : planned ? 'border-planned-border' : 'border-border-control',
        ),
      };
    }
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
      cell={chartCellSize(rest.code, size)}
      gap={CHART_GLYPH_GAP}
      padding={CHART_GLYPH_PADDING}
      ring={ring}
      paint={paint}
    />
  );
}

/** The read-only grid shared by the chart and history variants; `paint(null)` colours the single
 * simple-mode cell, `paint(surface)` each surface cell. */
function GlyphGrid({
  code,
  mode,
  orientation,
  cell,
  gap,
  padding,
  ring,
  paint,
}: Omit<GlyphBase, 'tooth'> & {
  cell: number;
  gap: number;
  padding: number;
  ring?: keyof typeof RING | undefined;
  paint: (surface: SurfaceKey | null) => Paint;
}) {
  const boxClass = cn('grid flex-none', ring && RING[ring]);

  if (mode === 'simple') {
    const box = simpleBox(cell);
    const { mark, className } = paint(null);
    return (
      <span
        aria-hidden
        data-glyph
        data-ring={ring}
        className={boxClass}
        style={{
          gridTemplateColumns: `${box.width}px`,
          gridTemplateRows: `${box.height}px`,
          padding,
        }}
      >
        <span data-mark={mark} className={className} style={{ borderRadius: box.radius }} />
      </span>
    );
  }

  const surfaces = surfaceCells(code, orientation);
  return (
    <span
      aria-hidden
      data-glyph
      data-ring={ring}
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
    </span>
  );
}
