/** What the toolbar drives a stage with. */
export interface StageHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actual: () => void;
}

/** A view measured against the fitted one, so two stages of different images can share it. */
export interface RelativeView {
  /** 1 is fitted. */
  zoom: number;
  x: number;
  y: number;
}

/** The reading aids (§4): seen through, never saved. */
export interface ImageFilters {
  invert: boolean;
  /** 1 is unchanged. */
  brightness: number;
  contrast: number;
}

export const NO_FILTERS: ImageFilters = { invert: false, brightness: 1, contrast: 1 };
