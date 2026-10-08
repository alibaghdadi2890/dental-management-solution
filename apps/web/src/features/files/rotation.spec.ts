import { describe, expect, it } from 'vitest';
import { addRotation, rotateClockwise, rotatedSize, rotationStyle, swapsAxes } from './rotation';

describe('rotation (F8)', () => {
  it('turns by quarters and comes back round', () => {
    expect(rotateClockwise(0)).toBe(90);
    expect(rotateClockwise(90)).toBe(180);
    expect(rotateClockwise(270)).toBe(0);
  });

  it('adds the turns made in the viewer to the stored rotation', () => {
    expect(addRotation(90, 180)).toBe(270);
    expect(addRotation(270, 180)).toBe(90);
    expect(addRotation(0, 0)).toBe(0);
  });

  it('swaps the sides of a sideways image', () => {
    const size = { width: 1600, height: 900 };
    expect(swapsAxes(90)).toBe(true);
    expect(swapsAxes(180)).toBe(false);
    expect(rotatedSize(size, 270)).toEqual({ width: 900, height: 1600 });
    expect(rotatedSize(size, 180)).toEqual(size);
  });

  it('styles nothing for an upright image', () => {
    expect(rotationStyle(0)).toBeUndefined();
    expect(rotationStyle(90)).toEqual({ transform: 'rotate(90deg)' });
  });
});
