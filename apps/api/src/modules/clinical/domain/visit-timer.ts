/** The visit fields the timer reads (`visits` row). */
export interface VisitTimerFacts {
  startedAt: Date;
  pausedAt: Date | null;
  pausedSeconds: number;
  completedAt: Date | null;
}

const wholeSecondsBetween = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

/**
 * Seconds of actual work on the visit (spec §Domain rules, W19): from `startedAt` to the moment
 * the clock stopped (`completedAt`, else `pausedAt`, else `now`), less the time spent paused.
 * Whole seconds, never negative. The visit's duration is `durationMinutes` (contracts) of this.
 */
export function elapsedSeconds(visit: VisitTimerFacts, now: Date): number {
  const stoppedAt = visit.completedAt ?? visit.pausedAt ?? now;
  return Math.max(0, wholeSecondsBetween(visit.startedAt, stoppedAt) - visit.pausedSeconds);
}

/** The visit's `pausedSeconds` after resuming at `now`: the pause that ends is added to it. */
export function resumePausedSeconds(
  visit: { pausedAt: Date; pausedSeconds: number },
  now: Date,
): number {
  return visit.pausedSeconds + wholeSecondsBetween(visit.pausedAt, now);
}
