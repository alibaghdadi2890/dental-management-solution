import type { OpeningDay } from '@dcm/contracts';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';

/** A half-open span of time: `[start, end)`. */
export interface Interval {
  start: Date;
  end: Date;
}

/** Adjacent spans do not overlap: one appointment may start as the last ends. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function overlapsAny(span: Interval, busy: readonly Interval[]): boolean {
  return busy.some((interval) => overlaps(span, interval));
}

export function plusMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

/** 0 is Sunday, for the tenant-local date `YYYY-MM-DD`. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The dates of an inclusive range. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let day = new Date(`${from}T00:00:00Z`);
    day.toISOString().slice(0, 10) <= to;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

/** The hours of `date` as instants; null when the branch is closed that day. */
export function openingInterval(
  date: string,
  hours: readonly OpeningDay[],
  timeZone: string,
): Interval | null {
  const day = hours.find((candidate) => candidate.weekday === weekdayOf(date));
  if (!day?.isOpen) return null;
  return {
    start: zonedInstant(date, day.from, timeZone),
    end: zonedInstant(date, day.to, timeZone),
  };
}

/** The tenant-local date a span starts on. */
export function startDateOf(span: Interval, timeZone: string): string {
  return localDate(span.start, timeZone);
}
