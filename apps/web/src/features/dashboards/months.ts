const asDate = (month: string) => new Date(`${month}-01T00:00:00Z`);
const lang = (locale: string) => (locale === 'en' ? 'en-US' : locale);

/** A month as a short tick: "Nov". */
export const monthLabel = (month: string, locale: string): string =>
  new Intl.DateTimeFormat(lang(locale), { month: 'short', timeZone: 'UTC' }).format(asDate(month));

/** A month in words: "November 2026". */
export const monthTitle = (month: string, locale: string): string =>
  new Intl.DateTimeFormat(lang(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    asDate(month),
  );

/** A weekday's short name (0 = Sunday), in the app's language. */
export const weekdayLabel = (weekday: number, locale: string): string =>
  new Intl.DateTimeFormat(lang(locale), { weekday: 'short', timeZone: 'UTC' }).format(
    // 2026-11-15 is a Sunday.
    new Date(Date.UTC(2026, 10, 15 + weekday)),
  );
