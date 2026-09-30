import type { ChartMode, ToothVisualState } from '@dcm/contracts';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/** The 3×3 grid, row-major, as indices into `surfaceCells` (`[left, buccal, right, centre,
 * lingual]`); `null` is a transparent corner. */
export const CELL_MAP = [null, 1, null, 0, 3, 2, null, 4, null] as const;

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

/** The selected tooth's ring (spec §Tooth states → Selected): the accent ring plus its halo. */
export const SELECTED_SHADOW =
  'shadow-[0_0_0_2px_var(--color-primary),0_0_0_5px_rgba(59,63,143,.16)]';
/** The planned tooth's ring (spec §Tooth states → Planned treatment). */
export const PLANNED_SHADOW = 'shadow-[0_0_0_1.5px_var(--color-planned-border)]';

/** The chart glyph's cell gap and outer padding, in px. */
export const CHART_GLYPH_GAP = 1;
export const CHART_GLYPH_PADDING = 1;

/** The simple-mode single cell (spec §Construction): `size × 2.2` by `size × 2.7`, radius
 * `size × 0.34` — 26×32 px at 12 px cells. */
export function simpleBox(size: number): { width: number; height: number; radius: number } {
  return {
    width: Math.round(size * 2.2),
    height: Math.round(size * 2.7),
    radius: Math.round(size * 0.34),
  };
}

/** A chart glyph's outer box at `size` px cells, padding included: the chart sizes every column
 * and glyph row from it, so upper and lower columns and both number rows line up. */
export function chartGlyphBox(mode: ChartMode, size: number): { width: number; height: number } {
  if (mode === 'simple') {
    const box = simpleBox(size);
    return {
      width: box.width + CHART_GLYPH_PADDING * 2,
      height: box.height + CHART_GLYPH_PADDING * 2,
    };
  }
  const side = size * 3 + CHART_GLYPH_GAP * 2 + CHART_GLYPH_PADDING * 2;
  return { width: side, height: side };
}

/** One cell's fill and edge. A selected tooth draws its unmarked (or whole-tooth-marked) cells
 * with an accent edge, while a surface's own service mark keeps its edge — as in the POC. */
export function cellClass(mark: ToothVisualState, accentEdge: boolean): string {
  return cn('border', FILL[mark], accentEdge ? 'border-primary' : EDGE[mark]);
}

export function gridStyle(cell: number, gap: number, padding: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(3, ${cell}px)`,
    gridTemplateRows: `repeat(3, ${cell}px)`,
    gap,
    padding,
  };
}
