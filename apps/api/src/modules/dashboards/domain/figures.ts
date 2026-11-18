/**
 * The dashboards' own arithmetic (feature 19): only what no home screen totals — the wait at
 * check-in, the visit lengths, medians. Pure; every figure that a home screen totals comes from
 * that module's own service instead (ADR-0087).
 */

/** A visit started from an appointment: its start, and the appointment's check-in. */
export interface WaitFacts {
  startedAt: Date;
  /** The visit's clinic-local date. */
  localDate: string;
  checkedInAt: Date | null;
  /** The check-in's clinic-local date. */
  checkedInDate: string | null;
}

/**
 * Minutes from check-in to the start of the visit, the same clinic day; null without a
 * check-in, on another day, or for a visit started before its check-in was recorded.
 */
export function waitMinutes(facts: WaitFacts): number | null {
  if (facts.checkedInAt === null || facts.checkedInDate !== facts.localDate) return null;
  const minutes = (facts.startedAt.getTime() - facts.checkedInAt.getTime()) / 60_000;
  return minutes >= 0 ? minutes : null;
}

/** The median (the mean of the middle two for an even count), rounded to a minute; null if none. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const value = sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
  return Math.round(value);
}

/** The mean rounded to a minute; null when there is nothing to average. */
export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

/** The wait figures of a set of visits: how many waited, the median, how many over 15 minutes. */
export function waitFigures(waits: readonly (number | null)[]): {
  count: number;
  medianMinutes: number | null;
  over15: number;
} {
  const known = waits.filter((wait): wait is number => wait !== null);
  return {
    count: known.length,
    medianMinutes: medianOf(known),
    over15: known.filter((wait) => wait > 15).length,
  };
}
