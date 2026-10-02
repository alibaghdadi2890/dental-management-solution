import {
  idSchema,
  VISIT_RANGES,
  type VisitFilters,
  type VisitListQuery,
  type VisitRange,
} from '@dcm/contracts';
import { z } from 'zod';

/** The Visits screen's tabs (spec §Visits page): *Unpaid* is `billing`'s route. */
export const VISIT_TABS = ['all', 'in_progress', 'unpaid', 'voided_amended'] as const;
export type VisitTab = (typeof VISIT_TABS)[number];

export const VISIT_PAGE_SIZES = [10, 25, 50] as const;
export type VisitPageSize = (typeof VISIT_PAGE_SIZES)[number];

/** Where the list starts and where *Clear filters* returns to (D11: the last 90 days). */
export const DEFAULT_RANGE: VisitRange = '90d';

/** The URL of `/visits`: the tab, the filters, the page size and the open visit. */
export interface VisitsSearch {
  tab: VisitTab;
  range: VisitRange;
  dentist?: string | undefined;
  room?: string | undefined;
  q?: string | undefined;
  size: VisitPageSize;
  /** The visit whose detail panel is open. */
  visit?: string | undefined;
}

export const VISITS_SEARCH_DEFAULTS = { tab: 'all', range: DEFAULT_RANGE, size: 10 } as const;

const searchSchema = z.object({
  tab: z.enum(VISIT_TABS).catch('all'),
  range: z.enum(VISIT_RANGES).catch(DEFAULT_RANGE),
  dentist: idSchema.optional().catch(undefined),
  room: idSchema.optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  size: z.coerce
    .number()
    .pipe(z.union([z.literal(10), z.literal(25), z.literal(50)]))
    .catch(10),
  visit: idSchema.optional().catch(undefined),
});

/** What a `<Link>` or `navigate` may pass: everything defaults. */
export type VisitsSearchInput = Partial<VisitsSearch>;

/** Never throws: an unknown or malformed value falls back to its default. */
export function parseVisitsSearch(raw: unknown): VisitsSearch {
  return searchSchema.parse(raw && typeof raw === 'object' ? raw : {});
}

/** The list filters the API takes for this search (*Unpaid* is the `all` tab on `billing`'s
 * route). */
export function filtersOf(search: VisitsSearch): VisitFilters {
  return {
    tab: search.tab === 'unpaid' ? 'all' : search.tab,
    range: search.range,
    dentistId: search.dentist,
    roomId: search.room,
    q: search.q,
  };
}

export function listQueryOf(search: VisitsSearch, cursor: string | undefined): VisitListQuery {
  return { ...filtersOf(search), limit: search.size, ...(cursor === undefined ? {} : { cursor }) };
}

/** How many filters differ from their default (the *Clear filters* button shows when any do). */
export function activeFilterCount(search: VisitsSearch): number {
  return [
    search.range !== DEFAULT_RANGE,
    search.dentist !== undefined,
    search.room !== undefined,
    search.q !== undefined,
  ].filter(Boolean).length;
}

/** Back to the defaults (90 days, any dentist and room, no search); the tab and size stay. */
export function clearFilters(search: VisitsSearch): VisitsSearch {
  return { tab: search.tab, range: DEFAULT_RANGE, size: search.size, visit: search.visit };
}

/** The query string the export and the API share (`URLSearchParams` order is stable). */
export function filterParams(filters: VisitFilters): Record<string, string> {
  const params: Record<string, string> = { tab: filters.tab, range: filters.range };
  if (filters.dentistId !== undefined) params['dentistId'] = filters.dentistId;
  if (filters.roomId !== undefined) params['roomId'] = filters.roomId;
  if (filters.q !== undefined) params['q'] = filters.q;
  if (filters.patientId !== undefined) params['patientId'] = filters.patientId;
  return params;
}
