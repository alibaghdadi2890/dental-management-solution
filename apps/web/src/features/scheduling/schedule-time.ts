import { type Appointment, MARK_COLORS, type MarkColor, type OpeningDay } from '@dcm/contracts';
import { fromZonedInput, toZonedInput } from '@/lib/zoned-time';

/** Calendar days and clock times in the clinic's zone (CLAUDE.md §13). Pure. */

export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 0 is Sunday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The Monday of the week `date` falls in. */
export function mondayOf(date: string): string {
  const weekday = weekdayOf(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export function weekOf(date: string): string[] {
  const monday = mondayOf(date);
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(monday, offset));
}

/** The instant a clock time on a clinic day is. */
export function instantOf(date: string, time: string, timeZone: string): Date {
  const iso = fromZonedInput(`${date}T${time}`, timeZone);
  if (iso === null) throw new Error(`not a time: ${date} ${time}`);
  return new Date(iso);
}

/** `2026-03-12` and `10:42` of an instant, in the clinic's zone. */
export function clinicClock(
  value: Date | string,
  timeZone: string,
): { date: string; time: string } {
  const [date = '', time = ''] = toZonedInput(
    typeof value === 'string' ? value : value.toISOString(),
    timeZone,
  ).split('T');
  return { date, time };
}

export const minutesOf = (time: string): number => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
};

export const clockOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const DEFAULT_BOUNDS = { from: 8 * 60, to: 18 * 60 };

/**
 * The grid's bounds (A5, G17): the earliest opening to the latest closing of the visible days,
 * widened to hold every appointment there, so one booked at 18:30 can be seen. With every visible
 * day closed and nothing booked: 08:00–18:00.
 */
export function gridBounds(
  dates: readonly string[],
  hours: readonly OpeningDay[],
  appointments: readonly Pick<Appointment, 'startsAt' | 'endsAt'>[],
  timeZone: string,
): { from: number; to: number } {
  const edges: number[] = [];
  for (const date of dates) {
    const day = hours.find((candidate) => candidate.weekday === weekdayOf(date));
    if (day?.isOpen) edges.push(minutesOf(day.from), minutesOf(day.to));
  }
  for (const appointment of appointments) {
    const start = clinicClock(appointment.startsAt, timeZone);
    const end = clinicClock(appointment.endsAt, timeZone);
    edges.push(minutesOf(start.time));
    edges.push(end.date === start.date ? minutesOf(end.time) : 24 * 60 - 1);
  }
  if (edges.length === 0) return DEFAULT_BOUNDS;
  return {
    from: Math.floor(Math.min(...edges) / 60) * 60,
    to: Math.min(24 * 60 - 1, Math.ceil(Math.max(...edges) / 60) * 60),
  };
}

export function isClosedDay(date: string, hours: readonly OpeningDay[]): boolean {
  return !hours.find((candidate) => candidate.weekday === weekdayOf(date))?.isOpen;
}

/** Whether a clock minute of `date` is outside the branch's hours. */
export function isClosedAt(date: string, minutes: number, hours: readonly OpeningDay[]): boolean {
  const day = hours.find((candidate) => candidate.weekday === weekdayOf(date));
  if (!day?.isOpen) return true;
  return minutes < minutesOf(day.from) || minutes >= minutesOf(day.to);
}

/** The palette keys in the order dentists take them: spread, so neighbours differ. */
const DENTIST_COLORS: readonly MarkColor[] = [
  'blue',
  'green',
  'orange',
  'violet',
  'teal',
  'magenta',
  'amber',
  'sky',
];

/** A dentist's stable colour, from their place in staff order (A5). */
export function dentistColor(order: number): MarkColor {
  return DENTIST_COLORS[order % DENTIST_COLORS.length] ?? MARK_COLORS[0];
}
