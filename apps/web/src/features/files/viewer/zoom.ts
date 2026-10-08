/**
 * The viewer's zoom and pan (feature 8, §4 Viewer). `scale` is CSS pixels per image pixel, so
 * the readout is the true percentage and 1:1 is `scale = 1`; `x` / `y` move the image's centre
 * away from the stage's centre. Pure: the stage component feeds it sizes and pointer positions.
 */
export interface Size {
  width: number;
  height: number;
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MAX_SCALE = 8;
/** One press of `+` / `−`, one notch of a zoom button. */
export const ZOOM_STEP = 1.25;

/** The largest scale at which the whole image shows; a small image is never blown up to fit. */
export function fitScale(image: Size, stage: Size): number {
  if (image.width <= 0 || image.height <= 0 || stage.width <= 0 || stage.height <= 0) return 1;
  return Math.min(1, stage.width / image.width, stage.height / image.height);
}

export function fitView(image: Size, stage: Size): View {
  return { scale: fitScale(image, stage), x: 0, y: 0 };
}

/** Zooming out stops at half the fitted size; zooming in at 800%. */
function clampScale(scale: number, image: Size, stage: Size): number {
  return Math.min(MAX_SCALE, Math.max(fitScale(image, stage) / 2, scale));
}

/** Keeps the image from being dragged off the stage: an axis that fits stays centred. */
export function clampView(view: View, image: Size, stage: Size): View {
  const scale = clampScale(view.scale, image, stage);
  const limit = (imageSide: number, stageSide: number) =>
    Math.max(0, (imageSide * scale - stageSide) / 2);
  const within = (value: number, max: number) =>
    max === 0 ? 0 : Math.min(max, Math.max(-max, value));
  return {
    scale,
    x: within(view.x, limit(image.width, stage.width)),
    y: within(view.y, limit(image.height, stage.height)),
  };
}

/**
 * Zooms by `factor`, keeping the image point under `anchor` — the pointer, measured from the
 * stage's centre — where it is. Without an anchor the stage's centre stays put.
 */
export function zoomBy(
  view: View,
  factor: number,
  image: Size,
  stage: Size,
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): View {
  const scale = clampScale(view.scale * factor, image, stage);
  const ratio = scale / view.scale;
  return clampView(
    {
      scale,
      x: anchor.x - (anchor.x - view.x) * ratio,
      y: anchor.y - (anchor.y - view.y) * ratio,
    },
    image,
    stage,
  );
}

export function panBy(view: View, dx: number, dy: number, image: Size, stage: Size): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, image, stage);
}

/** Whether the view is the fitted one: what double-click toggles away from, and back to. */
export function isFitted(view: View, image: Size, stage: Size): boolean {
  return Math.abs(view.scale - fitScale(image, stage)) < 0.001 && view.x === 0 && view.y === 0;
}

/** Double-click: fit ↔ 100%, zooming towards the point clicked. */
export function toggleFit(
  view: View,
  image: Size,
  stage: Size,
  anchor?: { x: number; y: number },
): View {
  if (!isFitted(view, image, stage)) return fitView(image, stage);
  return zoomBy(view, 1 / view.scale, image, stage, anchor);
}

/** The readout: `scale` as a whole percentage. */
export function zoomPercent(view: View): number {
  return Math.round(view.scale * 100);
}
