import { isoDateSchema } from '@dcm/contracts';
import type { DateInputOrder } from './format';

/**
 * Typed dates in the tenant's own day/month order (design Q17, `dateInputOrder`), to and from the
 * ISO `YYYY-MM-DD` the API stores. Pure, so the date input stays a thin shell around it.
 */

const SEPARATORS = /[/.\-\s]+/;

function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** The typed pieces in reading order, or `null` when the text isn't three numbers yet. An
 * unseparated `DDMMYYYY`-style run of eight digits is split by the order's own widths. */
function piecesOf(text: string, order: DateInputOrder): [string, string, string] | null {
  const trimmed = toAsciiDigits(text).trim();
  if (/^\d{8}$/.test(trimmed)) {
    return order === 'YMD'
      ? [trimmed.slice(0, 4), trimmed.slice(4, 6), trimmed.slice(6)]
      : [trimmed.slice(0, 2), trimmed.slice(2, 4), trimmed.slice(4)];
  }
  const parts = trimmed.split(SEPARATORS);
  const [first, second, third] = parts;
  if (parts.length !== 3 || !first || !second || !third) return null;
  return [first, second, third];
}

/** `'07/03/2019'` (DMY) → `'2019-03-07'`; `null` for anything that isn't a real calendar date with
 * a four-digit year. */
export function parseDateText(text: string, order: DateInputOrder): string | null {
  const pieces = piecesOf(text, order);
  if (!pieces) return null;
  const [a, b, c] = pieces;
  const [year, month, day] = order === 'YMD' ? [a, b, c] : order === 'MDY' ? [c, a, b] : [c, b, a];
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) return null;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isoDateSchema.safeParse(iso).success ? iso : null;
}

/** An ISO date written in the tenant order (`'2019-03-07'` → `'07/03/2019'` for DMY); any other
 * text — blank, or still being typed — is returned unchanged. */
export function dateTextOf(value: string, order: DateInputOrder): string {
  if (!isoDateSchema.safeParse(value).success) return value;
  const [year = '', month = '', day = ''] = value.split('-');
  const pieces =
    order === 'YMD'
      ? [year, month, day]
      : order === 'MDY'
        ? [month, day, year]
        : [day, month, year];
  return pieces.join('/');
}

/** An ISO calendar date as a local `Date` at noon, the form a date picker works in — built from
 * its year/month/day, never `new Date(iso)` (UTC midnight, the day before west of Greenwich), and
 * at noon so no DST change at midnight moves it; `undefined` for anything else. */
export function calendarDateOf(value: string): Date | undefined {
  if (!isoDateSchema.safeParse(value).success) return undefined;
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  const date = new Date(2000, month - 1, day, 12);
  date.setFullYear(year, month - 1, day);
  return date;
}

/** The ISO calendar date of a picked local `Date`: its own year/month/day, no timezone maths. */
export function isoOfCalendarDate(date: Date): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}
