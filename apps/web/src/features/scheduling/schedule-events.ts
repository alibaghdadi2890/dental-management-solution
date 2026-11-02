import type { Appointment } from '@dcm/contracts';
import { clinicClock } from './schedule-time';

export type ScheduleView = 'day' | 'week';

/** Three or more overlapping appointments in a week column read as one card (the design's). */
const CROWDED_LANES = 3;

export interface EventCluster {
  /** The tenant-local day: the card opens it. */
  date: string;
  count: number;
  inClinic: number;
  firstNames: string[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  dentistId: string;
  appointment: Appointment;
  /** A move waiting for its confirmation: drawn where it would go. */
  pending?: boolean;
  /** How many cards share this one's width. */
  lanes?: number;
  /** Week view: this card stands for several; `appointment` is only the first of them. */
  cluster?: EventCluster;
}

interface Laid {
  lanes: number;
  group: number;
}

/**
 * Side-by-side lanes for one column: overlapping runs of cards form a group, and each card learns how
 * many lanes its group needs. Adjacent cards do not overlap.
 */
export function layOutLanes(events: readonly CalendarEvent[]): Map<string, Laid> {
  const laid = new Map<string, Laid>();
  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime(),
  );
  let group: CalendarEvent[] = [];
  let groupEnd = -Infinity;
  let groupNumber = 0;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const event of group) {
      const free = laneEnds.findIndex((end) => end <= event.start.getTime());
      if (free >= 0) laneEnds[free] = event.end.getTime();
      else laneEnds.push(event.end.getTime());
    }
    for (const event of group) laid.set(event.id, { lanes: laneEnds.length, group: groupNumber });
    groupNumber += 1;
    group = [];
  };
  for (const event of sorted) {
    if (group.length > 0 && event.start.getTime() >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, event.end.getTime());
  }
  if (group.length > 0) flush();
  return laid;
}

const firstName = (fullName: string) => fullName.split(/\s+/)[0] ?? fullName;

function clusterOf(events: readonly CalendarEvent[], date: string): CalendarEvent | null {
  const [first] = events;
  if (!first) return null;
  return {
    ...first,
    id: `cluster-${first.id}`,
    start: new Date(Math.min(...events.map((event) => event.start.getTime()))),
    end: new Date(Math.max(...events.map((event) => event.end.getTime()))),
    cluster: {
      date,
      count: events.length,
      inClinic: events.filter(({ appointment }) =>
        ['checked_in', 'in_room'].includes(appointment.status),
      ).length,
      firstNames: events.map(({ appointment }) => firstName(appointment.patient.fullName)),
    },
  };
}

function groupBy(
  events: readonly CalendarEvent[],
  keyOf: (event: CalendarEvent) => string,
): CalendarEvent[][] {
  const columns = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = keyOf(event);
    columns.set(key, [...(columns.get(key) ?? []), event]);
  }
  return [...columns.values()];
}

/**
 * What the grid draws. Day: each dentist's column, its cards told their lanes. Week: each day's
 * column, every dentist in it, and a crowded run collapsed into one card that opens the day. A card
 * mid-move is never collapsed: it is the one being looked at.
 */
export function arrangeEvents(
  events: readonly CalendarEvent[],
  view: ScheduleView,
  timeZone: string,
): CalendarEvent[] {
  const dayOf = (event: CalendarEvent) => clinicClock(event.start, timeZone).date;
  const keyOf = (event: CalendarEvent) =>
    view === 'week' ? dayOf(event) : `${dayOf(event)}|${event.dentistId}`;
  return groupBy(events, keyOf).flatMap((column) => {
    const laid = layOutLanes(column);
    const withLanes = column.map((event) => ({
      ...event,
      lanes: laid.get(event.id)?.lanes ?? 1,
    }));
    if (view === 'day') return withLanes;
    const crowded = new Map<number, CalendarEvent[]>();
    const rest: CalendarEvent[] = [];
    for (const event of withLanes) {
      const place = laid.get(event.id);
      if (place && place.lanes >= CROWDED_LANES && !event.pending) {
        crowded.set(place.group, [...(crowded.get(place.group) ?? []), event]);
      } else {
        rest.push(event);
      }
    }
    const clusters = [...crowded.values()].flatMap((group) => {
      const sorted = [...group].sort((a, b) => a.start.getTime() - b.start.getTime());
      const first = sorted[0];
      const cluster = first ? clusterOf(sorted, dayOf(first)) : null;
      return cluster ? [cluster] : [];
    });
    return [...rest, ...clusters];
  });
}
