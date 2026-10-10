import { useCallback, useEffect, useState } from 'react';
import type { ChartHighlight } from './tooth-render';
import { useChartView } from './use-chart-view';

export interface ChartHighlighting {
  highlight: ChartHighlight | null;
  /** A legend click: highlights the item, or clears it when it already is. */
  toggle: (item: ChartHighlight) => void;
  clear: () => void;
}

/** Marks the card whose legend highlights: `Esc` clears the highlight from inside it. */
export const CHART_CARD = 'data-chart-card';

/** Keys typed here belong to the field or the layer, never to the chart. */
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]';

const same = (a: ChartHighlight | null, b: ChartHighlight) =>
  a !== null && a.kind === b.kind && a.id === b.id;

/**
 * The legend's highlight (feature 9, M11): one catalog item at a time; the chart fades every
 * tooth that does not carry it. It ends when the chart it was made on changes — another view,
 * or `chart`, the caller's own key for what is drawn (the dentition on screen) — since the item
 * may not be there any more. The chart card also clears it when a tooth is selected.
 *
 * `Esc` clears it before the page deselects a tooth, but only where the key is the chart's: with
 * the focus in the chart card or nowhere, no dialog or menu open, and not while typing in a field.
 */
export function useChartHighlight(chart: string): ChartHighlighting {
  const [view] = useChartView();
  const [highlight, setHighlight] = useState<ChartHighlight | null>(null);
  // Reset while rendering, so no frame shows the old highlight on the new chart.
  const scope = `${view}/${chart}`;
  const [lastScope, setLastScope] = useState(scope);
  if (lastScope !== scope) {
    setLastScope(scope);
    setHighlight(null);
  }

  const clear = useCallback(() => {
    setHighlight(null);
  }, []);
  const toggle = useCallback((item: ChartHighlight) => {
    setHighlight((current) => (same(current, item) ? null : item));
  }, []);

  const active = highlight !== null;
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const inCard =
        target === null || target === document.body || target.closest(`[${CHART_CARD}]`);
      if (!inCard || target?.closest(FIELD) || document.querySelector(LAYER)) return;
      event.preventDefault();
      event.stopPropagation();
      setHighlight(null);
    };
    // Capture: ahead of the page's own Esc handler, which deselects the tooth.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [active]);

  return { highlight, toggle, clear };
}
