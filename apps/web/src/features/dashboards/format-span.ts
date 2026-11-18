import type { DateSpan } from '@dcm/contracts';
import { formatDayMonth } from '@/lib/format';

/** "1–18 Nov", "28 Oct – 3 Nov", "1 Nov 2025 – 31 Oct 2026". */
export function formatSpan(span: DateSpan, locale: string): string {
  const sameYear = span.from.slice(0, 4) === span.to.slice(0, 4);
  const thisYear = span.to.slice(0, 4) === String(new Date().getUTCFullYear());
  const day = (iso: string) => String(Number(iso.slice(8, 10)));
  if (span.from === span.to) return formatDayMonth(span.from, locale);
  if (sameYear && span.from.slice(0, 7) === span.to.slice(0, 7) && locale === 'en') {
    return `${day(span.from)}–${formatDayMonth(span.to, locale)}`;
  }
  const end = (iso: string) =>
    sameYear && thisYear
      ? formatDayMonth(iso, locale)
      : `${formatDayMonth(iso, locale)} ${iso.slice(0, 4)}`;
  return `${end(span.from)} – ${end(span.to)}`;
}
