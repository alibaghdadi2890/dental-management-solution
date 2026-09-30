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
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface GlyphBase {
  code: ToothCode;
  /** Absent when nothing is recorded on the tooth. */
  tooth: ToothState | undefined;
  mode: ChartMode;
  orientation: ChartOrientation;
}

/** A tooth in the arch: 12 px cells (full chart) or 8 px (compact). Not interactive itself — the
 * chart's column button is. */
interface ChartGlyphProps extends GlyphBase {
  variant: 'chart';
  size: 12 | 8;
  selected?: boolean;
  notErupted?: boolean;
}

/** The selected-tooth panel's enlarged glyph: 24 px surfaces that toggle the pending scope. */
interface PanelGlyphProps extends GlyphBase {
  variant: 'panel';
  pendingSurfaces: readonly SurfaceKey[];
  onSurfaceClick: (surface: SurfaceKey) => void;
}

/** The tooth-history dialog's 15 px read-only glyph. */
interface HistoryGlyphProps extends GlyphBase {
  variant: 'history';
}

export type ToothGlyphProps = ChartGlyphProps | PanelGlyphProps | HistoryGlyphProps;

/** The 3×3 grid, row-major, as indices into `surfaceCells` (`[left, buccal, right, centre,
 * lingual]`); `null` is a transparent corner. */
const CELL_MAP = [null, 1, null, 0, 3, 2, null, 4, null] as const;

const PANEL_CELL = 24;
const HISTORY_CELL = 15;
/** The simple-mode panel glyph is a fixed 52×64 cell (spec §Selected Tooth Panel). */
const PANEL_SIMPLE = { width: 52, height: 64, radius: 8 } as const;

const FILL: Record<ToothVisualState, string> = {
  treated_today: 'bg-primary',
  treated: 'bg-primary-tint-border',
  planned: 'bg-planned-bg',
  none: 'bg-surface',
};

const EDGE: Record<ToothVisualState, string> = {
  treated_today: 'border-primary',
  treated: 'border-primary-tint-strong',
  planned: 'border-planned-border',
  none: 'border-border-control',
};

const RING = {
  selected: 'rounded-[4px] shadow-[0_0_0_2px_var(--color-primary),0_0_0_5px_rgba(59,63,143,.16)]',
  planned: 'rounded-[4px] shadow-[0_0_0_1.5px_var(--color-planned-border)]',
} as const;

/** Primary teeth draw at 0.78× (never under 6 px) so the dentition reads at a glance. */
function chartCellSize(code: ToothCode, size: number): number {
  return isPrimary(code) ? Math.max(6, Math.round(size * 0.78)) : size;
}

function simpleBox(size: number): { width: number; height: number; radius: number } {
  return {
    width: Math.round(size * 2.2),
    height: Math.round(size * 2.7),
    radius: Math.round(size * 0.34),
  };
}

function gridStyle(cell: number, gap: number, padding: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(3, ${cell}px)`,
    gridTemplateRows: `repeat(3, ${cell}px)`,
    gap,
    padding,
  };
}

/** One cell's fill and edge. A selected tooth draws its unmarked (or whole-tooth-marked) cells
 * with an accent edge, while a surface's own service mark keeps its edge — as in the POC. */
function cellClass(mark: ToothVisualState, accentEdge: boolean): string {
  return cn('border', FILL[mark], accentEdge ? 'border-primary' : EDGE[mark]);
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
 * overall state. The planned and selected rings sit on the chart variant's box.
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
      gap={1}
      padding={1}
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

/** The panel shows what was done to each surface, not the plan wash: planned reads as untreated. */
function panelMark(tooth: ToothState | undefined, surface: SurfaceKey): ToothVisualState {
  const mark = cellMark(tooth, surface);
  return mark === 'planned' ? 'none' : mark;
}

const PANEL_SURFACE: Record<'pending' | ToothVisualState, string> = {
  pending: 'border-primary-hover bg-primary text-white',
  treated_today: 'border-primary-tint-strong bg-primary text-white',
  treated: 'border-primary-tint-strong bg-primary-tint-border text-ink-secondary',
  planned: 'border-border-control bg-surface text-ink-secondary',
  none: 'border-border-control bg-surface text-ink-secondary',
};

function PanelGlyph({
  code,
  tooth,
  mode,
  orientation,
  pendingSurfaces,
  onSurfaceClick,
}: PanelGlyphProps) {
  const { t } = useTranslation('clinical');

  if (mode === 'simple') {
    // The panel's tooth is the selected one, so its outline is the accent (as in the POC).
    const mark = tooth?.state ?? 'none';
    return (
      <div
        data-glyph
        className="grid flex-none"
        style={{
          gridTemplateColumns: `${PANEL_SIMPLE.width}px`,
          gridTemplateRows: `${PANEL_SIMPLE.height}px`,
        }}
      >
        <span
          data-mark={mark}
          className={cellClass(mark, true)}
          style={{ borderRadius: PANEL_SIMPLE.radius }}
        />
      </div>
    );
  }

  const surfaces = surfaceCells(code, orientation);
  return (
    <div data-glyph className="grid flex-none" style={gridStyle(PANEL_CELL, 2, 0)}>
      {CELL_MAP.map((index, position) => {
        if (index === null) return <span key={position} />;
        const surface = surfaces[index];
        const mark = panelMark(tooth, surface);
        const pending = pendingSurfaces.includes(surface);
        const name = t(`surface.${surface}`);
        const title = mark === 'none' ? name : t('glyph.surfaceTreated', { name });
        return (
          <button
            key={position}
            type="button"
            data-surface={surface}
            data-mark={mark}
            title={title}
            aria-label={title}
            aria-pressed={pending}
            onClick={() => {
              onSurfaceClick(surface);
            }}
            className={cn(
              'grid cursor-pointer place-items-center rounded-[2px] border p-0 text-[12.5px] leading-none font-semibold',
              PANEL_SURFACE[pending ? 'pending' : mark],
            )}
          >
            {t(`surfaceShort.${surface}`)}
          </button>
        );
      })}
    </div>
  );
}
