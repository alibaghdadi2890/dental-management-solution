/** The appointment popover's width; its class says the same. */
export const POPOVER_WIDTH = 340;
export const POPOVER_GAP = 8;
export const POPOVER_EDGE = 12;
/** About what the popover needs to show whole above or below a card. */
const POPOVER_HEIGHT = 300;

export type PopoverSide = 'left' | 'right' | 'top' | 'bottom';

export interface PopoverPlacement {
  side: PopoverSide;
  /** From where the card is now to what the popover is anchored at, so it follows a scroll. */
  anchor: (card: DOMRect) => DOMRect;
}

/**
 * Where a card's popover goes: beside the card, the inline end first; when the card is too wide for
 * either side (one dentist's day), under or over it at the click; when it is also too tall, at the
 * click. `point` is where the click landed, from the card's top-left corner.
 */
export function placePopover(
  card: DOMRect,
  viewport: { width: number; height: number },
  { point, rtl }: { point?: { x: number; y: number }; rtl: boolean },
): PopoverPlacement {
  const across = POPOVER_WIDTH + POPOVER_GAP + POPOVER_EDGE;
  const right = viewport.width - card.right;
  const end = rtl ? 'left' : 'right';
  const start = rtl ? 'right' : 'left';
  if ((rtl ? card.left : right) >= across) return { side: end, anchor: (now) => now };
  if ((rtl ? right : card.left) >= across) return { side: start, anchor: (now) => now };

  const x = point?.x ?? (rtl ? card.width : 0);
  const band = (now: DOMRect) => new DOMRect(now.left + x, now.top, 0, now.height);
  const down = POPOVER_HEIGHT + POPOVER_GAP + POPOVER_EDGE;
  if (viewport.height - card.bottom >= down) return { side: 'bottom', anchor: band };
  if (card.top >= down) return { side: 'top', anchor: band };

  const y = point?.y ?? Math.min(card.height, 24);
  return { side: end, anchor: (now) => new DOMRect(now.left + x, now.top + y, 0, 0) };
}
