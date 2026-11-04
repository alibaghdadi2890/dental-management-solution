import { describe, expect, it } from 'vitest';
import { placePopover } from './popover-placement';

const viewport = { width: 1400, height: 900 };
const card = (left: number, top: number, width: number, height: number) =>
  new DOMRect(left, top, width, height);
const at = (rect: DOMRect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });

describe('placePopover', () => {
  it('goes beside a card, after it first, before it when the end has no room', () => {
    expect(placePopover(card(200, 300, 300, 60), viewport, { rtl: false }).side).toBe('right');
    expect(placePopover(card(1000, 300, 300, 60), viewport, { rtl: false }).side).toBe('left');
    expect(placePopover(card(200, 300, 300, 60), viewport, { rtl: true }).side).toBe('right');
    expect(placePopover(card(1000, 300, 300, 60), viewport, { rtl: true }).side).toBe('left');
  });

  it('anchors beside at the card itself', () => {
    const rect = card(200, 300, 300, 60);
    expect(at(placePopover(rect, viewport, { rtl: false }).anchor(rect))).toEqual(at(rect));
  });

  it('goes under a card too wide for either side, at the click', () => {
    const wide = card(170, 400, 1200, 110);
    const placement = placePopover(wide, viewport, { point: { x: 600, y: 40 }, rtl: false });
    expect(placement.side).toBe('bottom');
    expect(at(placement.anchor(wide))).toEqual({ x: 770, y: 400, width: 0, height: 110 });
  });

  it('goes over it when there is no room under, and follows the card as it scrolls', () => {
    const wide = card(170, 700, 1200, 110);
    const placement = placePopover(wide, viewport, { point: { x: 600, y: 40 }, rtl: false });
    expect(placement.side).toBe('top');
    expect(at(placement.anchor(card(170, 640, 1200, 110)))).toEqual({
      x: 770,
      y: 640,
      width: 0,
      height: 110,
    });
  });

  it('opens at the click on a card too wide and too tall to go around', () => {
    const big = card(170, 100, 1200, 750);
    const placement = placePopover(big, viewport, { point: { x: 600, y: 300 }, rtl: false });
    expect(placement.side).toBe('right');
    expect(at(placement.anchor(big))).toEqual({ x: 770, y: 400, width: 0, height: 0 });
  });

  it('starts at the card inline start without a click (Enter, a link from the board)', () => {
    const wide = card(170, 400, 1200, 110);
    expect(at(placePopover(wide, viewport, { rtl: false }).anchor(wide)).x).toBe(170);
    expect(at(placePopover(wide, viewport, { rtl: true }).anchor(wide)).x).toBe(1370);
  });
});
