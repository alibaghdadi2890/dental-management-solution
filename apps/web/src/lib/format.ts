import type { Money } from '@dcm/contracts';

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
