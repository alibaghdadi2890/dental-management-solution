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
