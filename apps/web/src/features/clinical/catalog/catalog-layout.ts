import type { CatalogTab } from './catalog-draft';

/** POC column templates plus the Frequent star between Name and Category, for services the
 * Effect on tooth select after it (feature 7, H2), the chart Mark after Category: a colour, and
 * for services an icon (feature 9), and for services Added on and Sessions after the price
 * (feature 10). */
export const CATALOG_GRID: Record<CatalogTab, string> = {
  services: '96px minmax(200px,1fr) 44px 156px 140px 64px 112px 104px 128px 68px 52px 64px',
  diagnoses: '112px minmax(220px,1fr) 44px 150px 64px 52px 64px',
};

/** Under this width the table scrolls sideways instead of squeezing its inputs. */
export const CATALOG_MIN_WIDTH: Record<CatalogTab, number> = { services: 1230, diagnoses: 1010 };

/** 16×16 star of the Frequent column. */
export const STAR_PATH =
  'M8 1.6l1.95 3.95 4.35.63-3.15 3.07.74 4.34L8 11.54l-3.89 2.05.74-4.34L1.7 6.18l4.35-.63L8 1.6z';
