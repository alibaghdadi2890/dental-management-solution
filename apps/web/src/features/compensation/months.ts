/** Calendar months (`YYYY-MM`) for the screens' month pickers; pure. */

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  const [year = 0, index = 1] = month.split('-').map(Number);
  const zeroBased = year * 12 + (index - 1) + by;
  const nextYear = Math.floor(zeroBased / 12);
  return `${String(nextYear).padStart(4, '0')}-${String((zeroBased % 12) + 1).padStart(2, '0')}`;
}

/** "October 2026" in the UI language. */
export function formatMonth(month: string, locale: string): string {
  const [year = 0, index = 1] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, index - 1, 1)));
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A `?month=` value, else `fallback`. */
export function parseMonth(value: unknown, fallback: string): string {
  return typeof value === 'string' && MONTH.test(value) ? value : fallback;
}

/** The month's last day, `YYYY-MM-DD`. */
export function lastDayOf(month: string): string {
  const [year = 0, index = 1] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}
