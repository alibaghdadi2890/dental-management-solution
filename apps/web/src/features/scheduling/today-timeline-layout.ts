import type { AppointmentStatus } from '@dcm/contracts';

const HOUR = 3_600_000;
/** The now-line shows only this close to the day's appointments; later or earlier it would squash them. */
const NOW_REACH = 2 * HOUR;

/** What the strip needs of an appointment. */
export interface TimelineItem {
  id: string;
  dentistName: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
}

export interface TimelineBlock<T> {
  item: T;
  /** From the strip's start, as a fraction of its length. */
  left: number;
  width: number;
  /** Its row inside the lane: overlapping appointments stack. */
  track: number;
}

export interface TimelineLayout<T> {
  start: number;
  end: number;
  /** Each whole hour of the span (epoch ms) with its place. */
  ticks: { at: number; left: number }[];
  lanes: { dentistName: string; tracks: number; blocks: TimelineBlock<T>[] }[];
  /** The now-line's place, or null when now is off the strip. */
  now: number | null;
}

/** Off the day: struck or muted, stacked under what still holds its time. */
const INACTIVE: ReadonlySet<AppointmentStatus> = new Set(['cancelled', 'no_show', 'rescheduled']);

/** How far the time zone's wall clock is ahead of UTC at `instant`. */
export function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

const floorHour = (instant: number, timeZone: string) => {
  const offset = zoneOffsetMs(instant, timeZone);
  return Math.floor((instant + offset) / HOUR) * HOUR - offset;
};
const ceilHour = (instant: number, timeZone: string) => {
  const floored = floorHour(instant, timeZone);
  return floored === instant ? instant : floorHour(instant + HOUR, timeZone);
};

/**
 * The Today timeline's geometry: one lane per dentist (in the order they first appear), from the
 * whole hour before the first appointment to the whole hour after the last, stretched to take in
 * now when it is within two hours of them. Blocks that overlap in a lane take the next free track,
 * the appointments that still hold their time first. Empty: null.
 */
export function timelineLayout<T extends TimelineItem>(
  items: readonly T[],
  now: number,
  timeZone: string,
): TimelineLayout<T> | null {
  if (items.length === 0) return null;
  const first = Math.min(...items.map((item) => Date.parse(item.startsAt)));
  const last = Math.max(...items.map((item) => Date.parse(item.endsAt)));
  const near = now >= first - NOW_REACH && now <= last + NOW_REACH;
  const start = floorHour(near ? Math.min(first, now) : first, timeZone);
  const end = Math.max(ceilHour(near ? Math.max(last, now) : last, timeZone), start + HOUR);
  const length = end - start;
  const place = (instant: number) => (instant - start) / length;

  const ticks: TimelineLayout<T>['ticks'] = [];
  for (let at = start; at <= end; at += HOUR) ticks.push({ at, left: place(at) });

  const byDentist = new Map<string, T[]>();
  for (const item of items) {
    byDentist.set(item.dentistName, [...(byDentist.get(item.dentistName) ?? []), item]);
  }
  const lanes = [...byDentist].map(([dentistName, own]) => {
    const ordered = [...own].sort(
      (a, b) =>
        Number(INACTIVE.has(a.status)) - Number(INACTIVE.has(b.status)) ||
        Date.parse(a.startsAt) - Date.parse(b.startsAt),
    );
    // The end of what each track holds so far, by start order within its group.
    const trackEnds: { from: number; to: number }[][] = [];
    const blocks = ordered.map((item) => {
      const from = Date.parse(item.startsAt);
      const to = Math.max(Date.parse(item.endsAt), from);
      let track = trackEnds.findIndex((taken) =>
        taken.every((span) => to <= span.from || from >= span.to),
      );
      if (track === -1) track = trackEnds.push([]) - 1;
      trackEnds[track]?.push({ from, to });
      return { item, left: place(from), width: (to - from) / length, track };
    });
    return { dentistName, tracks: Math.max(1, trackEnds.length), blocks };
  });

  return { start, end, ticks, lanes, now: now >= start && now <= end ? place(now) : null };
}

/** Waiting's minutes, and how long is too long: warning from 10, danger from 20. */
export const WAIT_WARNING_MIN = 10;
export const WAIT_DANGER_MIN = 20;

export function waitingTone(minutes: number): 'normal' | 'warning' | 'danger' {
  if (minutes >= WAIT_DANGER_MIN) return 'danger';
  if (minutes >= WAIT_WARNING_MIN) return 'warning';
  return 'normal';
}
