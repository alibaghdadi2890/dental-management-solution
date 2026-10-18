/**
 * The calendar date (`YYYY-MM-DD`) that `instant` falls on in the IANA `timeZone` — "today" for a
 * tenant is `localDate(clock.now(), tenant.timeZone)` (CLAUDE.md §5: local-time logic uses the
 * tenant time zone). Pure: no I/O, no ambient clock; the caller passes the instant.
 */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/** The offset of `timeZone` from UTC at `instant`, in minutes (Beirut in winter: 120). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant a wall-clock `time` (`HH:MM`) on the calendar `date` (`YYYY-MM-DD`) is in the IANA
 * `timeZone` — the inverse of `localDate`. A time skipped by a daylight-saving change reads as
 * the same clock time after it. Pure.
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const first = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  return new Date(wall - offsetMinutes(new Date(first), timeZone) * 60_000);
}
