import { describe, expect, it } from 'vitest';
import {
  clampView,
  fitScale,
  fitView,
  isFitted,
  MAX_SCALE,
  panBy,
  toggleFit,
  zoomBy,
  zoomPercent,
} from './zoom';

const stage = { width: 1000, height: 800 };
const pano = { width: 4000, height: 2000 };
const small = { width: 300, height: 200 };

describe('fit', () => {
  it('shrinks a large image to the stage and never enlarges a small one', () => {
    expect(fitScale(pano, stage)).toBe(0.25);
    expect(fitScale({ width: 1000, height: 3200 }, stage)).toBe(0.25);
    expect(fitScale(small, stage)).toBe(1);
  });

  it('is 1 until the sizes are known', () => {
    expect(fitScale({ width: 0, height: 0 }, stage)).toBe(1);
    expect(fitScale(pano, { width: 0, height: 0 })).toBe(1);
  });

  it('centres the fitted image', () => {
    const view = fitView(pano, stage);
    expect(view).toEqual({ scale: 0.25, x: 0, y: 0 });
    expect(isFitted(view, pano, stage)).toBe(true);
    expect(zoomPercent(view)).toBe(25);
  });
});

describe('zoom', () => {
  it('keeps the point under the pointer where it is', () => {
    const view = fitView(pano, stage);
    const anchor = { x: 200, y: -100 };
    // The image point under the anchor, in image pixels from the image centre.
    const under = (at: typeof view) => ({
      x: (anchor.x - at.x) / at.scale,
      y: (anchor.y - at.y) / at.scale,
    });
    const zoomed = zoomBy(view, 2, pano, stage, anchor);
    expect(zoomed.scale).toBe(0.5);
    expect(under(zoomed).x).toBeCloseTo(under(view).x);
    expect(under(zoomed).y).toBeCloseTo(under(view).y);
  });

  it('stops at 800% and at half the fitted size', () => {
    const view = fitView(pano, stage);
    expect(zoomBy(view, 1000, pano, stage).scale).toBe(MAX_SCALE);
    expect(zoomBy(view, 0.001, pano, stage).scale).toBe(0.125);
  });

  it('comes back to centre when zoomed out to where the image fits', () => {
    const zoomedIn = zoomBy(fitView(pano, stage), 4, pano, stage, { x: 400, y: 300 });
    expect(zoomedIn.x).not.toBe(0);
    expect(zoomBy(zoomedIn, 1 / 4, pano, stage)).toEqual({ scale: 0.25, x: 0, y: 0 });
  });
});

describe('pan', () => {
  it('moves a zoomed image, but not off the stage', () => {
    const view = { scale: 1, x: 0, y: 0 };
    expect(panBy(view, 100, -50, pano, stage)).toEqual({ scale: 1, x: 100, y: -50 });
    // 4000 px wide on a 1000 px stage: 1500 px of travel each way.
    expect(panBy(view, 99_999, -99_999, pano, stage)).toEqual({ scale: 1, x: 1500, y: -600 });
  });

  it('keeps an axis that fits centred', () => {
    expect(panBy(fitView(pano, stage), 300, 300, pano, stage)).toEqual({ scale: 0.25, x: 0, y: 0 });
    expect(clampView({ scale: 0.3, x: 500, y: 500 }, pano, stage)).toEqual({
      scale: 0.3,
      x: 100,
      y: 0,
    });
  });
});

describe('double-click', () => {
  it('toggles between fit and 100%', () => {
    const fitted = fitView(pano, stage);
    const actual = toggleFit(fitted, pano, stage, { x: 100, y: 0 });
    expect(actual.scale).toBe(1);
    expect(toggleFit(actual, pano, stage)).toEqual(fitted);
  });

  it('does nothing visible to an image already at 100% that fits', () => {
    const fitted = fitView(small, stage);
    expect(toggleFit(fitted, small, stage)).toEqual(fitted);
  });
});
