import {
  type ChartOrientation,
  type DentitionStage,
  keyboardOrder,
  positionKey,
  presentTooth,
  type ToothCode,
} from '@dcm/contracts';
import { useEffect } from 'react';

export interface ChartKeyboardOptions {
  orientation: ChartOrientation;
  dentition: DentitionStage;
  selected: ToothCode | null;
  /** A jaw or the whole mouth is selected: `Esc` deselects it; the arrows walk teeth only. */
  areaSelected?: boolean;
  /** The next tooth, or `null` to deselect. */
  onSelect: (code: ToothCode | null) => void;
  /** Set while a layer is open over the workspace (the catalog drawer): `Esc` closes it (this
   * callback) instead of deselecting, even with focus outside it, and the arrows do nothing, so
   * the selection can't move under the layer. */
  onEscape?: (() => void) | undefined;
}

/** Keys typed here belong to the field or the layer, never to the chart. */
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]';

function ignoredTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`${FIELD}, ${LAYER}`) !== null;
}

/**
 * The tooth one step from `selected` along `keyboardOrder` (upper row left to right, then the
 * lower row, wrapping), as the chart on screen shows that column.
 */
function step(
  selected: ToothCode,
  direction: 1 | -1,
  { orientation, dentition }: Pick<ChartKeyboardOptions, 'orientation' | 'dentition'>,
): ToothCode {
  const order = keyboardOrder(orientation, dentition);
  const index = order.findIndex((column) => column === positionKey(selected));
  const column = order[(index + direction + order.length) % order.length];
  if (column === undefined) return selected;
  return presentTooth(column, dentition).code;
}

/**
 * The workspace chart's keyboard (spec §Dental Chart → Interactions, W3): with a tooth selected,
 * ← and → walk the arch in the clinic's orientation, wrapping — the chart is never mirrored
 * (W17), so the arrows follow the screen even in an RTL layout. `Esc` closes the topmost layer
 * first: a dialog or menu (the drawer included) handles it itself while focus is inside it, the
 * drawer otherwise through `onEscape`; only then does it deselect. Keys are left alone while
 * focus is in a field or inside a dialog or menu, with a modifier held, and — the arrows — while
 * a layer is open.
 */
export function useChartKeyboard({
  orientation,
  dentition,
  selected,
  areaSelected = false,
  onSelect,
  onEscape,
}: ChartKeyboardOptions): void {
  useEffect(() => {
    if (selected === null && !areaSelected && !onEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (ignoredTarget(event.target)) return;
      if (event.key === 'Escape') {
        if (onEscape) onEscape();
        else onSelect(null);
        return;
      }
      if (selected === null || onEscape) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      onSelect(step(selected, direction, { orientation, dentition }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [orientation, dentition, selected, areaSelected, onSelect, onEscape]);
}
