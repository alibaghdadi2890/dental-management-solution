import type { CatalogTab } from './catalog-draft';

/** A column: a fixed width, or a share of the room left that never goes below `min`. */
type Track = number | { min: number; share: number };

/** The rows' `gap-2` and `px-3.5`, which the minimum width counts. */
const GAP = 8;
const INLINE_PADDING = 14;

/** POC columns plus the Frequent star between Name and Category, for services the Effect on
 * tooth select after it (feature 7, H2), the chart Mark after Category: a colour, and for
 * services an icon (feature 9), and for services Added on and Sessions after the price
 * (feature 10); for diagnoses the Level after the Mark (ADR-0064). Name and Category take the
 * room the page has. */
const TRACKS: Record<CatalogTab, Track[]> = {
  services: [
    64,
    { min: 160, share: 2 },
    36,
    156,
    { min: 104, share: 1 },
    64,
    120,
    80,
    116,
    64,
    44,
    48,
  ],
  diagnoses: [96, { min: 200, share: 2 }, 36, { min: 120, share: 1 }, 64, 120, 44, 48],
};

const template = (tracks: Track[]) =>
  tracks
    .map((track) =>
      typeof track === 'number' ? `${track}px` : `minmax(${track.min}px,${track.share}fr)`,
    )
    .join(' ');

/** What the columns, their gaps and the row's padding need: below it the table scrolls sideways
 * instead of squeezing its inputs; above it, it fills the page. */
const minWidth = (tracks: Track[]) =>
  tracks.reduce<number>((sum, track) => sum + (typeof track === 'number' ? track : track.min), 0) +
  GAP * (tracks.length - 1) +
  INLINE_PADDING * 2;

export const CATALOG_GRID: Record<CatalogTab, string> = {
  services: template(TRACKS.services),
  diagnoses: template(TRACKS.diagnoses),
};

export const CATALOG_MIN_WIDTH: Record<CatalogTab, number> = {
  services: minWidth(TRACKS.services),
  diagnoses: minWidth(TRACKS.diagnoses),
};

/** 16×16 star of the Frequent column. */
export const STAR_PATH =
  'M8 1.6l1.95 3.95 4.35.63-3.15 3.07.74 4.34L8 11.54l-3.89 2.05.74-4.34L1.7 6.18l4.35-.63L8 1.6z';
