import {
  type ChartOrientation,
  type DentitionStage,
  keyboardOrder,
  positionKey,
  presentTooth,
  type ToothCode,
  type ToothPresence,
} from '@dcm/contracts';
import { useEffect } from 'react';

export interface ChartKeyboardOptions {
  orientation: ChartOrientation;
  dentition: DentitionStage;
  /** Per-position presence records (W5): which tooth a column holds, as the chart shows it. */
  toothStatus: readonly ToothPresence[];
  selected: ToothCode | null;
  /** The next tooth, or `null` to deselect. */
  onSelect: (code: ToothCode | null) => void;
}

/** Keys typed here belong to the field or the layer, never to the chart. */
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]';

function ignoredTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`${FIELD}, ${LAYER}`) !== null;
}

/**
 * The tooth one step from `selected` along `keyboardOrder` (upper row left to right, then the
 * lower row, wrapping), resolved to the tooth actually present in that column.
 */
function step(
  selected: ToothCode,
  direction: 1 | -1,
  { orientation, dentition, toothStatus }: Omit<ChartKeyboardOptions, 'selected' | 'onSelect'>,
): ToothCode {
  const order = keyboardOrder(orientation);
  const index = order.findIndex((column) => column === positionKey(selected));
  const column = order[(index + direction + order.length) % order.length];
  if (column === undefined) return selected;
  const presence = toothStatus.find((record) => record.position === column)?.present;
  return presentTooth(column, dentition, presence).code;
}

/**
 * The workspace chart's keyboard (spec §Dental Chart → Interactions, W3): with a tooth selected,
 * ← and → walk the arch in the clinic's orientation, wrapping — the chart is never mirrored
 * (W17), so the arrows follow the screen even in an RTL layout. `Esc` deselects, unless a layer
 * above (a dialog, a menu, the drawer) already took it: the topmost layer closes first. Keys are
 * left alone while focus is in a field or inside a dialog or menu, and with a modifier held.
 */
export function useChartKeyboard({
  orientation,
  dentition,
  toothStatus,
  selected,
  onSelect,
}: ChartKeyboardOptions): void {
  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (ignoredTarget(event.target)) return;
      if (event.key === 'Escape') {
        onSelect(null);
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      onSelect(step(selected, direction, { orientation, dentition, toothStatus }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [orientation, dentition, toothStatus, selected, onSelect]);
}
