import { OPENING_MIN_FREED_MINUTES, type OpeningDay } from '@dcm/contracts';
import { localDate } from '../../../platform/kernel/local-date';
import { type Interval, openingInterval } from './intervals';

/** A cancelled or moved appointment whose start is still ahead: the time it held (B1). */
export interface FreedSlot extends Interval {
  appointmentId: string;
  dentistId: string;
}

/** An active appointment of a dentist, in any branch: a dentist may work in two. */
export interface DentistBusy extends Interval {
  dentistId: string;
}

/**
 * A dentist's free time around freed time (B1, ADR-0104). `freed` is the freed time still free in
 * it; `id` is its first freed appointment. A freed slot split by a booking in its middle is part of
 * two openings, so an opening is found by its id and an instant inside it.
 */
export interface Opening extends Interval {
  id: string;
  dentistId: string;
  /** The clinic-local day. */
  date: string;
  freed: Interval[];
  freedAppointmentIds: string[];
}

export interface OpeningsInput {
  /** The branch's freed slots of active dentists. */
  freed: readonly FreedSlot[];
  busy: readonly DentistBusy[];
  /** The branch's opening hours as they are now. */
  hours: readonly OpeningDay[];
  timeZone: string;
  now: Date;
}

const minutes = (interval: Interval) =>
  (interval.end.getTime() - interval.start.getTime()) / 60_000;

/** Sorted, overlapping and adjacent spans joined. */
export function union(spans: readonly Interval[]): Interval[] {
  const sorted = [...spans]
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const joined: Interval[] = [];
  for (const span of sorted) {
    const last = joined.at(-1);
    if (last && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
    } else {
      joined.push({ start: span.start, end: span.end });
    }
  }
  return joined;
}

const clip = (span: Interval, to: Interval): Interval | null => {
  const start = span.start > to.start ? span.start : to.start;
  const end = span.end < to.end ? span.end : to.end;
  return end > start ? { start, end } : null;
};

/** `window` minus `busy`: the free runs, in order. */
export function freeRuns(window: Interval, busy: readonly Interval[]): Interval[] {
  const runs: Interval[] = [];
  let cursor = window.start;
  for (const span of union(busy)) {
    if (span.end <= cursor) continue;
    if (span.start >= window.end) break;
    if (span.start > cursor) runs.push({ start: cursor, end: span.start });
    if (span.end > cursor) cursor = span.end;
  }
  if (cursor < window.end) runs.push({ start: cursor, end: window.end });
  return runs;
}

/**
 * Every opening of a branch: per dentist and freed day, the day's opening hours after now, minus
 * the dentist's active appointments; each free run holding at least 15 minutes of freed time is
 * one opening. Soonest first. Pure: the caller read the rows.
 */
export function findOpenings(input: OpeningsInput): Opening[] {
  const { hours, timeZone, now } = input;
  const groups = new Map<string, FreedSlot[]>();
  for (const slot of input.freed) {
    if (slot.start <= now) continue;
    const key = `${slot.dentistId}|${localDate(slot.start, timeZone)}`;
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  const openings: Opening[] = [];
  for (const [key, slots] of groups) {
    const [dentistId = '', date = ''] = key.split('|');
    const hoursOfDay = openingInterval(date, hours, timeZone);
    if (hoursOfDay === null) continue;
    const window = clip(hoursOfDay, { start: now, end: hoursOfDay.end });
    if (window === null) continue;
    const busy = input.busy.filter((span) => span.dentistId === dentistId);
    const freedTime = union(slots.flatMap((slot) => clip(slot, window) ?? []));
    for (const run of freeRuns(window, busy)) {
      const freed = freedTime.flatMap((part) => clip(part, run) ?? []);
      const total = freed.reduce((sum, part) => sum + minutes(part), 0);
      if (total < OPENING_MIN_FREED_MINUTES) continue;
      const inRun = slots
        .filter((slot) => clip(slot, run) !== null)
        .sort(
          (a, b) =>
            a.start.getTime() - b.start.getTime() || a.appointmentId.localeCompare(b.appointmentId),
        );
      const first = inRun[0];
      if (!first) continue;
      openings.push({
        id: first.appointmentId,
        dentistId,
        date,
        start: run.start,
        end: run.end,
        freed,
        freedAppointmentIds: inRun.map((slot) => slot.appointmentId),
      });
    }
  }
  return openings.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.dentistId.localeCompare(b.dentistId),
  );
}

/** The opening a freed appointment is part of: the one holding `at` when given, else the soonest. */
export function openingOf(
  openings: readonly Opening[],
  appointmentId: string,
  at?: Date,
): Opening | null {
  const candidates = openings.filter((opening) =>
    opening.freedAppointmentIds.includes(appointmentId),
  );
  if (at === undefined) return candidates[0] ?? null;
  return candidates.find((opening) => opening.start <= at && at < opening.end) ?? null;
}
