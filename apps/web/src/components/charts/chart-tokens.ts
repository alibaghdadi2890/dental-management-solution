/**
 * The chart colours (feature 19, ADR-0091), defined once against the theme (`styles.css`
 * `--color-chart-*`). **Identity**: a series keeps one colour on every chart of both dashboards,
 * four at most per chart, the rest folded into `other`. **Magnitude**: one hue, light to dark.
 * **State**: the Schedule's status colours, used for appointment outcomes only. Text never wears a
 * series colour; no extra hues are ever generated.
 */
export const SERIES = {
  production: 'var(--color-chart-production)',
  collected: 'var(--color-chart-collected)',
  expenses: 'var(--color-chart-expenses)',
  other: 'var(--color-chart-other)',
} as const;
export type SeriesKey = keyof typeof SERIES;

/** Light to dark, one hue. */
export const RAMP = [
  'var(--color-chart-ramp-1)',
  'var(--color-chart-ramp-2)',
  'var(--color-chart-ramp-3)',
  'var(--color-chart-ramp-4)',
  'var(--color-chart-ramp-5)',
  'var(--color-chart-ramp-6)',
] as const;

/** Appointment outcomes, as the Schedule's status pills colour them. */
export const OUTCOME = {
  completed: 'var(--color-chart-completed)',
  cancelled: 'var(--color-chart-cancelled)',
  noShow: 'var(--color-chart-no-show)',
  unresolved: 'var(--color-chart-unresolved)',
} as const;

export const GRID = 'var(--color-chart-grid)';

/** The ramp step for `value` out of `max` (0 → the lightest; nothing → transparent). */
export function rampOf(value: number, max: number): string {
  if (max <= 0 || value <= 0) return 'transparent';
  const index = Math.min(RAMP.length - 1, Math.floor((value / max) * (RAMP.length - 1)));
  return RAMP[Math.max(0, index)] ?? RAMP[0];
}

/** Whether a ramp step is dark enough to need light text on it. */
export const isDarkStep = (color: string) => color === RAMP[4] || color === RAMP[5];
