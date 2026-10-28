import { durationMinutes } from '@dcm/contracts';
import { localDate } from '../../../platform/kernel/local-date';
import { VisitTimesInvalidError, VisitTimesOffDayError } from './visit-errors';

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
  startedAt: Date;
  completedAt: Date;
  /** The corrected times replace the timer: the pauses it counted are dropped. */
  pausedSeconds: 0;
  durationMinutes: number;
}

/**
 * The corrected start and end of a finished visit (ADR-0062). The start stays on the visit's
 * local date, so its money, records and compensation keep their day; the end is after the start,
 * within a day of it and not after `now`. The duration becomes end − start (`durationMinutes`).
 * Null when both are the visit's own: the correction leaves the times alone.
 *
 * @throws VisitTimesOffDayError when the start is on another day than the visit's.
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
  if (localDate(startedAt, timeZone) !== visit.localDate) {
    throw new VisitTimesOffDayError(`The visit must start on ${visit.localDate}`);
  }
  const span = completedAt.getTime() - startedAt.getTime();
  if (span <= 0) throw new VisitTimesInvalidError('The visit must end after it starts');
  if (span > MAX_SPAN_MS) throw new VisitTimesInvalidError('A visit lasts a day at most');
  if (completedAt.getTime() > now.getTime()) {
    throw new VisitTimesInvalidError('The visit cannot end in the future');
  }
  return {
    startedAt,
    completedAt,
    pausedSeconds: 0,
    durationMinutes: durationMinutes(Math.floor(span / 1000)),
  };
}
