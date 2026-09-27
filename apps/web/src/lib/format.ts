import { ageOn, formatPhoneFor, type Money } from '@dcm/contracts';

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

/** Formats a date-*only* value (`YYYY-MM-DD`, no time component: a date of birth, an opening
 * balance's "as of" date) by always reading it back with `timeZone: 'UTC'`. A calendar date has
 * no instant to convert — formatting it through the tenant's own timezone (as `formatDate` does
 * for a real timestamp) can shift it a day either way once that timezone's offset crosses
 * midnight relative to UTC (e.g. `America/New_York` would show `1999-12-31` for the timestamp
 * `2000-01-01T00:00:00Z`). */
export function formatCalendarDate(iso: string, locale: string): string {
  return formatDate(iso, { timeZone: 'UTC', locale });
}

/**
 * The record header / quick-view age line (design "`<age> yrs · <dob>`, the DOB alone, or 'Age
 * not recorded'"), as structured data — the surrounding text ("yrs", the "·" separator, "Age not
 * recorded") is an i18n concern, not this module's. `dob` is formatted with `formatCalendarDate`
 * (not `formatDate`): it's a calendar date, not an instant, so it must never shift with the
 * tenant's timezone the way `options.timeZone` would otherwise apply to a real timestamp.
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
  options: Pick<DateFormatOptions, 'locale'>,
): AgeLine {
  if (!dob) return { kind: 'unknown' };
  const formattedDob = formatCalendarDate(dob, options.locale);
  const age = ageOn(dob, today);
  return age < 0
    ? { kind: 'dobOnly', dob: formattedDob }
    : { kind: 'full', age, dob: formattedDob };
}

/** The stored E.164 number, formatted for display: national format for the tenant's own country,
 * international format otherwise (wraps the contracts' pure `formatPhoneFor` so call sites reach
 * for the one shared formatter, CLAUDE.md §13, instead of hand-rolling phone display). */
export function formatPhone(e164: string, country: string): string {
  return formatPhoneFor(e164, country as Parameters<typeof formatPhoneFor>[1]);
}

export type DateInputOrder = 'DMY' | 'MDY' | 'YMD';

/** Countries whose everyday convention is month/day/year. */
const MDY_COUNTRIES = new Set(['US', 'PH', 'FM', 'MH', 'PW', 'AS', 'GU', 'MP', 'PR', 'UM', 'VI']);
/** Countries whose everyday convention is year/month/day. */
const YMD_COUNTRIES = new Set(['CN', 'JP', 'KR', 'KP', 'TW', 'HU', 'MN', 'LT', 'IR']);

/**
 * The day/month/year input order a tenant expects (design Q17), from an explicit table keyed by
 * the tenant's own country rather than `Intl`: `Intl.DateTimeFormat` resolves the order from the
 * *language*'s own default when a language/region pairing has no distinct CLDR locale (this
 * runtime's ICU data collapses `en-LB` to plain `en`'s US/MDY order, not Lebanon's own DMY), so it
 * can't be trusted to reflect the tenant's country regardless of UI language. Every country not
 * listed defaults to DMY, the convention most of the world (and the platform's own default
 * country, `LB`) uses.
 */
export function dateInputOrder(country: string): DateInputOrder {
  const code = country.toUpperCase();
  if (MDY_COUNTRIES.has(code)) return 'MDY';
  if (YMD_COUNTRIES.has(code)) return 'YMD';
  return 'DMY';
}
