/**
 * An instant as a `datetime-local` value in a given time zone, and back. Dates on screen are the
 * clinic's (CLAUDE.md §13), never the browser's, so a field that edits a date and time cannot
 * hand the browser a `Date`: it converts through the clinic's zone both ways. Pure.
 */

const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function wallParts(instant: number, timeZone: string): number[] {
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
  return (['year', 'month', 'day', 'hour', 'minute', 'second'] as const).map((type) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0),
  );
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = wallParts(
    instant,
    timeZone,
  );
  return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(instant / 1000) * 1000;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** `2026-03-12T10:42`: what a `datetime-local` input shows for `iso` in `timeZone`. */
export function toZonedInput(iso: string, timeZone: string): string {
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0] = wallParts(Date.parse(iso), timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** The instant a `datetime-local` value names in `timeZone`, as ISO; null for anything else. */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const match = INPUT.exec(value);
  if (!match) return null;
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = match
    .slice(1)
    // The seconds are optional: their group is absent from a `HH:mm` value.
    .map((part: string | undefined) => Number(part ?? 0));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(asUtc) || new Date(asUtc).getUTCDate() !== day) return null;
  // The offset at the guess, then at the answer it gives: they differ only across a transition.
  const guess = asUtc - offsetAt(asUtc, timeZone);
  return new Date(asUtc - offsetAt(guess, timeZone)).toISOString();
}
