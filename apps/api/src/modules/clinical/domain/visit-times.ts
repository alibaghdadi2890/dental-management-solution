import { durationMinutes } from '@dcm/contracts';
import { localDate } from '../../../platform/kernel/local-date';
import { VisitTimesInvalidError } from './visit-errors';

/** The longest a visit may run once its times are corrected. */
const MAX_SPAN_MS = 24 * 60 * 60 * 1000;

/** The visit fields a time correction reads (`visits` row). */
export interface TimedVisit {
  localDate: string;
  startedAt: Date;
  completedAt: Date;
  pausedSeconds: number;
}

/** What a time correction writes. */
export interface VisitTimes {
  /** The start's day in the clinic's zone: the visit moves with it (ADR-0063). */
  localDate: string;
  startedAt: Date;
  completedAt: Date;
  /** The corrected times replace the timer: the pauses it counted are dropped. */
  pausedSeconds: 0;
  durationMinutes: number;
}

/**
 * The corrected start and end of a finished visit (ADR-0062, ADR-0063). The visit's local date
 * becomes the start's day in the clinic's zone — another day moves the visit; the end is after the
 * start, within a day of it and not after `now`. The duration becomes end − start
 * (`durationMinutes`). Null when both are the visit's own: the correction leaves the times alone.
 *
 * @throws VisitTimesInvalidError when the end is not after the start, more than a day after it,
 *   or in the future.
 */
export function planVisitTimes(
  visit: TimedVisit,
  input: { startedAt: Date; completedAt: Date },
  timeZone: string,
  now: Date,
): VisitTimes | null {
  const { startedAt, completedAt } = input;
  if (
    startedAt.getTime() === visit.startedAt.getTime() &&
    completedAt.getTime() === visit.completedAt.getTime()
  ) {
    return null;
  }
  const span = completedAt.getTime() - startedAt.getTime();
  if (span <= 0) throw new VisitTimesInvalidError('The visit must end after it starts');
  if (span > MAX_SPAN_MS) throw new VisitTimesInvalidError('A visit lasts a day at most');
  if (completedAt.getTime() > now.getTime()) {
    throw new VisitTimesInvalidError('The visit cannot end in the future');
  }
  return {
    localDate: localDate(startedAt, timeZone),
    startedAt,
    completedAt,
    pausedSeconds: 0,
    durationMinutes: durationMinutes(Math.floor(span / 1000)),
  };
}
