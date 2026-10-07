import type { ChartMode } from '@dcm/contracts';
import { type RefObject, useEffect, useState } from 'react';
import { chartGlyphBox } from './glyph-style';

/** The full chart's cell, and the largest one the expanded chart grows to. */
export const FULL_CELL = 12;
export const EXPANDED_MAX_CELL = 20;

/** The gap between two tooth columns on the full chart, in px. */
export const FULL_COLUMN_GAP = 5;

/** Everything in the arch block's width that is not a tooth column or a gap between two: the
 * block's own padding, the R and L markers with their gaps and, with jaw bars, each jaw's border
 * and padding. Mirrors `DentalChart`'s layout. */
function chromeWidth(withAreas: boolean): number {
  const padding = 2 * 6;
  const markers = 2 * (14 + 12);
  const jaw = withAreas ? 2 * (1 + 6) : 0;
  return padding + markers + jaw;
}

/** The arch block's width at `size` px cells. */
export function chartWidth(input: {
  mode: ChartMode;
  size: number;
  columns: number;
  withAreas: boolean;
}): number {
  const column = chartGlyphBox(input.mode, input.size).width;
  return (
    input.columns * column + (input.columns - 1) * FULL_COLUMN_GAP + chromeWidth(input.withAreas)
  );
}

/**
 * The largest cell, between the full chart's 12 px and 20 px, at which a jaw's `columns` teeth
 * fit in `available` px without scrolling. A space too narrow even for 12 px keeps 12 px: the
 * arch block scrolls, as the full chart always has.
 */
export function fitCellSize(input: {
  available: number;
  mode: ChartMode;
  columns: number;
  withAreas: boolean;
}): number {
  for (let size = EXPANDED_MAX_CELL; size > FULL_CELL; size -= 1) {
    if (chartWidth({ ...input, size }) <= input.available) return size;
  }
  return FULL_CELL;
}

/**
 * The cell size for the chart inside `ref`: 12 px unless `expanded`, then whatever fits the
 * element's width, followed as it resizes. Without `ResizeObserver` it stays at 12 px.
 */
export function useFittedCellSize(
  ref: RefObject<HTMLElement | null>,
  expanded: boolean,
  chart: { mode: ChartMode; columns: number; withAreas: boolean },
): number {
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!expanded || !element || typeof ResizeObserver === 'undefined') return undefined;
    // Observing reports the element's size once straight away, then on every change.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, expanded]);

  if (!expanded || available === 0) return FULL_CELL;
  return fitCellSize({ available, ...chart });
}
