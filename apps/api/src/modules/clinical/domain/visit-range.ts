import type { VisitRange } from '@dcm/contracts';

/** How many tenant-local days, today included, each date filter covers. */
const DAYS: Record<Exclude<VisitRange, 'all'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

/**
 * The first local date (`YYYY-MM-DD`) a visits date filter includes, counted back from the
 * tenant's `today`; null for `all`. Pure calendar arithmetic, no time zone involved: `today` is
 * already the tenant's.
 */
export function rangeStart(range: VisitRange, today: string): string | null {
  if (range === 'all') return null;
  return addDays(today, 1 - DAYS[range]);
}

/** `date` plus `days` (negative goes back), on the calendar. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}
