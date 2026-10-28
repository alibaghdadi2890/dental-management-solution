import type { VisitListItem } from '@dcm/contracts';
import { fromZonedInput, toZonedInput } from '@/lib/zoned-time';

/** A correction's day and times (ADR-0062, ADR-0063): a `yyyy-MM-dd` date and two `HH:mm` clock
 * times in the clinic's zone. */
export interface TimesDraft {
  date: string;
  start: string;
  end: string;
}

export type TimesProblem = 'missing' | 'order' | 'future';

type TimedVisit = Pick<VisitListItem, 'localDate' | 'startedAt' | 'completedAt'>;

/** `2026-06-10` → `2026-06-11`. */
function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** The visit's own day, start and end, to the minute, as the form opens on them. */
export function timesDraftOf(visit: TimedVisit, timeZone: string): TimesDraft {
  return {
    date: visit.localDate,
    start: toZonedInput(visit.startedAt, timeZone).slice(11),
    end: visit.completedAt ? toZonedInput(visit.completedAt, timeZone).slice(11) : '',
  };
}

/**
 * The instants a draft names: the start on its day, the end on that day too — or on the next one
 * when its clock time is before the start's (a visit past midnight). Null while the date or a time
 * is blank or malformed.
 */
export function timesOf(
  draft: TimesDraft,
  timeZone: string,
): { startedAt: string; completedAt: string; nextDay: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null;
  const startedAt = fromZonedInput(`${draft.date}T${draft.start}`, timeZone);
  const later = draft.end < draft.start;
  const completedAt = fromZonedInput(
    `${later ? nextDay(draft.date) : draft.date}T${draft.end}`,
    timeZone,
  );
  return startedAt && completedAt ? { startedAt, completedAt, nextDay: later } : null;
}

/** Whole minutes from start to end, as the API stores the duration; null while incomplete. */
export function draftMinutes(draft: TimesDraft, timeZone: string) {
  const times = timesOf(draft, timeZone);
  if (!times) return null;
  return Math.ceil((Date.parse(times.completedAt) - Date.parse(times.startedAt)) / 60_000);
}

/** What keeps the draft from saving, the API's rules checked ahead (`planVisitTimes`). */
export function timesProblem(draft: TimesDraft, timeZone: string, now: Date): TimesProblem | null {
  const times = timesOf(draft, timeZone);
  if (!times) return 'missing';
  if (times.completedAt === times.startedAt) return 'order';
  if (Date.parse(times.completedAt) > now.getTime()) return 'future';
  return null;
}

export const isTimesDirty = (draft: TimesDraft, visit: TimedVisit, timeZone: string) => {
  const initial = timesDraftOf(visit, timeZone);
  return draft.date !== initial.date || draft.start !== initial.start || draft.end !== initial.end;
};
