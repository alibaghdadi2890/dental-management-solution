import { ACTIVITY_AREAS, type ActivityArea, idSchema } from '@dcm/contracts';
import { z } from 'zod';

/** The Date filter: today, the last 7 / 30 / 90 days, or everything. */
export const ACTIVITY_RANGES = ['today', '7d', '30d', '90d', 'all'] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

/** The Person filter's value for platform admins acting in the clinic. */
export const PLATFORM_ADMIN = 'admin';

/**
 * The URL of `/activity` (feature 7, H7): the filters, and the record a "View all activity" link
 * came from (`patient` or `visit`). Everything is optional; a bad value reads as "not set".
 */
export interface ActivitySearch {
  area?: ActivityArea | undefined;
  /** A staff member's user id, or `admin`. */
  person?: string | undefined;
  range: ActivityRange;
  q?: string | undefined;
  patient?: string | undefined;
  visit?: string | undefined;
}

export const ACTIVITY_SEARCH_DEFAULTS = { range: '30d' } as const;

const optionalId = idSchema.optional().catch(undefined);

const searchSchema = z.object({
  area: z.enum(ACTIVITY_AREAS).optional().catch(undefined),
  person: z
    .union([z.literal(PLATFORM_ADMIN), idSchema])
    .optional()
    .catch(undefined),
  range: z.enum(ACTIVITY_RANGES).catch('30d'),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  patient: optionalId,
  visit: optionalId,
});

export type ActivitySearchInput = Partial<Record<keyof ActivitySearch, unknown>>;

export function parseActivitySearch(search: ActivitySearchInput): ActivitySearch {
  return searchSchema.parse(search);
}

/** Whether anything narrows the feed beyond the default 30 days ("Clear filters"). */
export function isFiltered(search: ActivitySearch): boolean {
  return (
    search.area !== undefined ||
    search.person !== undefined ||
    search.q !== undefined ||
    search.patient !== undefined ||
    search.visit !== undefined ||
    search.range !== ACTIVITY_SEARCH_DEFAULTS.range
  );
}

const DAYS: Record<Exclude<ActivityRange, 'all'>, number> = {
  today: 0,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * The instant a range starts: local midnight in `timeZone`, today or that many days back
 * (`today` is the clinic's `YYYY-MM-DD`). Undefined for "All".
 */
export function rangeStart(
  range: ActivityRange,
  today: string,
  timeZone: string,
): string | undefined {
  if (range === 'all') return undefined;
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day - DAYS[range]);
  // What the clinic's clock shows at that UTC instant tells how far the zone is from UTC.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMidnight));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const shown = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return new Date(utcMidnight - (shown - utcMidnight)).toISOString();
}

/** What a typed search is: a display number of a known kind, or a name. */
export type SearchTerm =
  | { kind: 'patientNumber' | 'visitNumber' | 'receiptNumber'; text: string }
  | { kind: 'name'; text: string };

export function searchTerm(q: string): SearchTerm {
  const text = q.trim();
  if (/^P-?\d+$/i.test(text)) return { kind: 'patientNumber', text };
  if (/^V-?\d+$/i.test(text)) return { kind: 'visitNumber', text };
  if (/^RCT-?\d+$/i.test(text)) return { kind: 'receiptNumber', text };
  return { kind: 'name', text };
}
