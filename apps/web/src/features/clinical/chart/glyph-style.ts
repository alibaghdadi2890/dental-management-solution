import { type ChartMode, markColorVars } from '@dcm/contracts';
import type { CSSProperties } from 'react';
import type { Fill } from './tooth-render';

/** The 3×3 grid, row-major, as indices into `surfaceCells` (`[left, buccal, right, centre,
 * lingual]`); `null` is a transparent corner. */
export const CELL_MAP = [null, 1, null, 0, 3, 2, null, 4, null] as const;

/** The selected tooth's ring (spec §Tooth states → Selected): the accent ring plus its halo. It
 * is also the keyboard's focus ring, drawn outside the glyph, on the card. */
export const SELECTED_SHADOW =
  'shadow-[0_0_0_2px_var(--color-primary),0_0_0_5px_rgba(59,63,143,.16)]';
/** The planned tooth's ring (spec §Tooth states → Planned treatment). */
export const PLANNED_SHADOW = 'shadow-[0_0_0_1.5px_var(--color-planned-border)]';
/** Work started and not finished (ADR-0032): a heavier, darker ring than the planned one. */
export const IN_PROGRESS_SHADOW = 'shadow-[0_0_0_2px_var(--color-warning-dot)]';

/** The chart glyph's cell gap and outer padding, in px. */
export const CHART_GLYPH_GAP = 1;
export const CHART_GLYPH_PADDING = 1;

/** The simple-mode tooth (feature 9, M8): `size × 2.2` wide; the crown `size × 2.7` high with a
 * `size × 0.34` radius, and the band `size × 0.9` at its root end (its gap included) — 26×43 px
 * in all at 12 px cells. */
export function simpleBox(size: number): {
  width: number;
  height: number;
  radius: number;
  band: number;
} {
  return {
    width: Math.round(size * 2.2),
    height: Math.round(size * 2.7),
    radius: Math.round(size * 0.34),
    band: Math.round(size * 0.9),
  };
}

/** A chart glyph's outer box at `size` px cells, padding included: the chart sizes every column
 * and glyph row from it, so upper and lower columns and both number rows line up. Since feature 9
 * a glyph is one row taller than its crown: the band, at the root end. */
export function chartGlyphBox(mode: ChartMode, size: number): { width: number; height: number } {
  if (mode === 'simple') {
    const box = simpleBox(size);
    return {
      width: box.width + CHART_GLYPH_PADDING * 2,
      height: box.height + box.band + CHART_GLYPH_PADDING * 2,
    };
  }
  return {
    width: size * 3 + CHART_GLYPH_GAP * 2 + CHART_GLYPH_PADDING * 2,
    height: size * 4 + CHART_GLYPH_GAP * 3 + CHART_GLYPH_PADDING * 2,
  };
}

/**
 * How one cell or body is painted (feature 9, M1, M2). A catalog colour says which item it is;
 * the tone says when: today is the saturated fill with a 1.5 px strong edge, earlier work the
 * same hue as a mid-tone with the default border. The planned wash and the plain cell are the
 * only fills that are not a catalog colour; on a selected tooth they take the accent edge, as
 * in the POC, while a mark keeps its own.
 */
export function fillStyle(fill: Fill | undefined, accentEdge: boolean): CSSProperties {
  if (fill === undefined || fill.color === 'none' || fill.color === 'planned') {
    const planned = fill?.color === 'planned';
    return {
      backgroundColor: planned ? 'var(--color-planned-bg)' : 'var(--color-surface)',
      borderColor: accentEdge
        ? 'var(--color-primary)'
        : planned
          ? 'var(--color-planned-border)'
          : 'var(--color-border-control)',
      borderWidth: 1,
    };
  }
  const vars = markColorVars(fill.color);
  return fill.tone === 'today'
    ? { backgroundColor: vars.fill, borderColor: vars.strong, borderWidth: 1.5, color: vars.on }
    : {
        backgroundColor: vars.tint,
        borderColor: 'var(--color-border-control)',
        borderWidth: 1,
        color: vars.strong,
      };
}

/** `data-fill` of a cell or body, for tests: `<colour>/<tone>`, or `none` for a plain one. */
export function fillName(fill: Fill | undefined): string {
  return fill && fill.color !== 'none' ? `${fill.color}/${fill.tone}` : 'none';
}

export function gridStyle(cell: number, gap: number, padding: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(3, ${cell}px)`,
    gridTemplateRows: `repeat(3, ${cell}px)`,
    gap,
    padding,
  };
}
