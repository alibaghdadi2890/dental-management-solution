import type { FileOrientation } from '@dcm/contracts';

/**
 * The stored rotation of an image (feature 8, F8): quarter turns clockwise, applied by CSS
 * wherever the image renders. The bytes are never touched. Pure.
 */

/** A quarter turn clockwise. */
export function rotateClockwise(orientation: FileOrientation): FileOrientation {
  return ((orientation + 90) % 360) as FileOrientation;
}

/** The stored rotation plus the turns made in the viewer and not saved yet. */
export function addRotation(stored: FileOrientation, turned: FileOrientation): FileOrientation {
  return ((stored + turned) % 360) as FileOrientation;
}

/** A sideways image takes the other dimension of its box. */
export function swapsAxes(orientation: FileOrientation): boolean {
  return orientation === 90 || orientation === 270;
}

/** The image's size as it shows once turned. */
export function rotatedSize(
  size: { width: number; height: number },
  orientation: FileOrientation,
): { width: number; height: number } {
  return swapsAxes(orientation) ? { width: size.height, height: size.width } : size;
}

/** For a thumbnail filling a square tile: turning it in place is enough. */
export function rotationStyle(orientation: FileOrientation): { transform: string } | undefined {
  return orientation === 0 ? undefined : { transform: `rotate(${orientation}deg)` };
}
