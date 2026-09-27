import { ageOn, type Money } from '@dcm/contracts';

/**
 * The one shared formatter for dates and money (CLAUDE.md §13). Dates always render in the
 * tenant's timezone, never the browser's.
 */
export interface DateFormatOptions {
  timeZone: string;
  /** App language: `en`, `ar` or `fr`. */
  locale: string;
}

type DateInput = Date | string;

const toDate = (value: DateInput) => (typeof value === 'string' ? new Date(value) : value);

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** "4 Sep 2026" in English (POC format); the locale's medium date otherwise. */
export function formatDate(value: DateInput, { timeZone, locale }: DateFormatOptions): string {
  const date = toDate(value);
  if (locale === 'en') {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone,
    }).formatToParts(date);
    return `${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date);
}

/** Date plus 24-hour time, e.g. "4 Sep 2026, 09:05". */
export function formatDateTime(value: DateInput, options: DateFormatOptions): string {
  const time = new Intl.DateTimeFormat(options.locale === 'en' ? 'en-GB' : options.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: options.timeZone,
  }).format(toDate(value));
  return `${formatDate(value, options)}, ${time}`;
}

/** "$1,234" when whole, "$1,234.50" otherwise, "−$30" for negatives (U+2212, per the POC). */
export function formatMoney({ amount, currency }: Money, locale: string): string {
  const value = Number(amount);
  const whole = Number.isInteger(value);
  const formatted = new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return value < 0 ? `−${formatted}` : formatted;
}

/** "$", "€", "IQD"… — the prefix of a price input. */
export function currencySymbol(currency: string, locale: string): string {
  return (
    new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}

/** "Today" in the tenant's own timezone, as an ISO `YYYY-MM-DD` (patients feature 3, design Q17):
 * a tenant whose local date has already rolled over relative to UTC (e.g. `Asia/Baghdad` at
 * 23:30 UTC) must not see yesterday's date as "today" in a date-of-birth or opening-balance field. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/**
 * The record header / quick-view age line (design "`<age> yrs · <dob>`, the DOB alone, or 'Age
 * not recorded'"), as structured data — the surrounding text ("yrs", the "·" separator, "Age not
 * recorded") is an i18n concern, not this module's. `dob` is formatted with `formatDate`, the one
 * shared formatter (CLAUDE.md §13), so it always reads in the tenant's own timezone and locale.
 *
 * - No `dob` at all → `unknown` ("Age not recorded").
 * - A `dob` that is on or before `today` → `full`, with the whole-years age from `ageOn`.
 * - A `dob` after `today` (bad data, or a tenant/browser clock skew) → `dobOnly`: showing a
 *   negative age would be nonsensical, so only the date renders.
 */
export type AgeLine =
  | { kind: 'unknown' }
  | { kind: 'dobOnly'; dob: string }
  | { kind: 'full'; age: number; dob: string };

export function formatAgeLine(
  dob: string | null,
  today: string,
  options: DateFormatOptions,
): AgeLine {
  if (!dob) return { kind: 'unknown' };
  const formattedDob = formatDate(dob, options);
  const age = ageOn(dob, today);
  return age < 0
    ? { kind: 'dobOnly', dob: formattedDob }
    : { kind: 'full', age, dob: formattedDob };
}

export type DateInputOrder = 'DMY' | 'MDY' | 'YMD';

const DATE_PART_LETTERS: Partial<Record<Intl.DateTimeFormatPartTypes, 'D' | 'M' | 'Y'>> = {
  day: 'D',
  month: 'M',
  year: 'Y',
};

/**
 * The day/month/year input order a tenant expects (design Q17: `en-LB` → DMY, `en-US` → MDY),
 * read from `Intl` for `${locale}-${country}` rather than hard-coded per country.
 *
 * Some language/region pairings have no distinct CLDR locale at all — this runtime's ICU data
 * resolves `en-LB` (and `fr-LB`) to the bare language's own default (`en`'s is US order) rather
 * than anything Lebanon-specific, silently dropping the region we asked for. `resolvedOptions()`
 * exposes exactly this: its `locale` keeps the region only when ICU actually had data for it. When
 * the region was dropped, the bare-language default can't be trusted to represent the tenant's
 * country, so this falls back to `DMY` — the convention most countries (and the platform's own
 * default country, `LB`) use — rather than an English-specific default that happens to be MDY.
 */
export function dateInputOrder(locale: string, country: string): DateInputOrder {
  const formatter = new Intl.DateTimeFormat(`${locale}-${country}`, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const resolvedRegion = formatter.resolvedOptions().locale.split('-')[1];
  if ((resolvedRegion ?? '').toUpperCase() !== country.toUpperCase()) {
    return 'DMY';
  }
  const order = formatter
    .formatToParts(new Date(Date.UTC(2000, 0, 2)))
    .map((p) => DATE_PART_LETTERS[p.type])
    .filter((letter): letter is 'D' | 'M' | 'Y' => letter !== undefined)
    .join('');
  return order === 'DMY' || order === 'MDY' || order === 'YMD' ? order : 'DMY';
}
