import { localDate } from '../../../platform/kernel/local-date';

/**
 * "Taken on" (feature 8, F7, spec D10): the clinically meaningful date of a file. Pure — the
 * caller passes the clock and the tenant's time zone.
 */

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
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
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
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

/**
 * The instant a camera's wall-clock time (`YYYY-MM-DDTHH:mm:ss`, EXIF `DateTimeOriginal`, no
 * zone) names in `timeZone` — the clinic's: the photo was taken there. Null for text that is not
 * a real date and time. A time inside a daylight-saving gap resolves to the instant after it.
 */
export function wallTimeToInstant(wallTime: string, timeZone: string): Date | null {
  const match = WALL_TIME.exec(wallTime);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const read = new Date(asUtc);
  if (
    read.getUTCFullYear() !== year ||
    read.getUTCMonth() !== month - 1 ||
    read.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  // The offset at the guess, then at the answer it gives: they differ only across a transition.
  const guess = asUtc - offsetAt(asUtc, timeZone);
  return new Date(asUtc - offsetAt(guess, timeZone));
}

/**
 * What a file is saved with: the camera's own time when the image carries one that is not in the
 * future (a camera with a wrong clock is not believed), else the start of the visit it is linked
 * to, else now.
 */
export function deriveTakenAt(input: {
  exifTakenAt: string | null | undefined;
  visitStartedAt: Date | null;
  now: Date;
  timeZone: string;
}): Date {
  const fromCamera = input.exifTakenAt
    ? wallTimeToInstant(input.exifTakenAt, input.timeZone)
    : null;
  if (fromCamera && fromCamera.getTime() <= input.now.getTime()) return fromCamera;
  return input.visitStartedAt ?? input.now;
}

/** An edited "taken on" is never after the clinic's today (F7). */
export function isAfterToday(takenAt: Date, now: Date, timeZone: string): boolean {
  return localDate(takenAt, timeZone) > localDate(now, timeZone);
}
