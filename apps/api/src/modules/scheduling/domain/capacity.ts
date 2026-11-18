import type { OpeningDay } from '@dcm/contracts';

const minutesOf = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/** The weekday (0 = Sunday) of a `YYYY-MM-DD` date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Minutes a branch is open on `date` by its weekly hours (ADR-0068); 0 when closed. */
export function openMinutes(hours: readonly OpeningDay[], date: string): number {
  const day = hours.find((candidate) => candidate.weekday === weekdayOf(date));
  return day?.isOpen ? Math.max(0, minutesOf(day.to) - minutesOf(day.from)) : 0;
}

/**
 * A branch's chair capacity over `dates` (feature 19, ADR-0090): opening minutes × active rooms,
 * day by day. Dentist schedules do not exist yet, so this is the only capacity there is.
 */
export function capacityMinutes(
  hours: readonly OpeningDay[],
  rooms: number,
  dates: readonly string[],
): number {
  return dates.reduce((total, date) => total + openMinutes(hours, date) * rooms, 0);
}

/** The whole hours a branch is open on some weekday, in order (the busy-hours grid's rows). */
export function openHours(hours: readonly OpeningDay[]): number[] {
  const open = new Set<number>();
  for (const day of hours) {
    if (!day.isOpen) continue;
    const start = Math.floor(minutesOf(day.from) / 60);
    const end = Math.ceil(minutesOf(day.to) / 60);
    for (let hour = start; hour < end; hour += 1) open.add(hour);
  }
  return [...open].sort((a, b) => a - b);
}
