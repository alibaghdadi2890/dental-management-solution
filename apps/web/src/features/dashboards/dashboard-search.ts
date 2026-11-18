import {
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  type DashboardQuery,
  type DashboardTab,
  idSchema,
  isoDateSchema,
} from '@dcm/contracts';
import { z } from 'zod';

/**
 * The Dashboard's URL (feature 19, D2): the tab, the period (a custom one with its dates), the
 * branch and, on Operational, the dentist — so a view can be bookmarked and Back from a
 * drill-down restores it. Defaults are left out; anything malformed is dropped, never an error.
 */
export interface DashboardSearch {
  tab?: 'operational' | undefined;
  period?: Exclude<DashboardPeriod, 'this_month'> | undefined;
  from?: string | undefined;
  to?: string | undefined;
  branch?: string | undefined;
  dentist?: string | undefined;
}

const schema = z.object({
  tab: z.enum(['operational']).optional().catch(undefined),
  period: z
    .enum(
      DASHBOARD_PERIODS.filter((period) => period !== 'this_month') as [
        Exclude<DashboardPeriod, 'this_month'>,
        ...Exclude<DashboardPeriod, 'this_month'>[],
      ],
    )
    .optional()
    .catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  branch: idSchema.optional().catch(undefined),
  dentist: idSchema.optional().catch(undefined),
});

export function parseDashboardSearch(raw: Record<string, unknown>): DashboardSearch {
  const parsed = schema.parse(raw);
  const custom = parsed.period === 'custom';
  const cleaned: DashboardSearch = {
    ...parsed,
    from: custom ? parsed.from : undefined,
    to: custom ? parsed.to : undefined,
    // The dentist filter is Operational's only.
    dentist: parsed.tab === 'operational' ? parsed.dentist : undefined,
  };
  return Object.fromEntries(Object.entries(cleaned).filter(([, value]) => value !== undefined));
}

export const tabOf = (search: DashboardSearch): DashboardTab => search.tab ?? 'financial';

/** The cards' query for this search: Operational's carries the dentist, Financial's never. */
export function queryOf(search: DashboardSearch): DashboardQuery {
  const period = search.period ?? 'this_month';
  return {
    period,
    ...(period === 'custom' ? { from: search.from, to: search.to } : {}),
    ...(search.branch ? { branchId: search.branch } : {}),
    ...(tabOf(search) === 'operational' && search.dentist ? { dentistId: search.dentist } : {}),
  };
}

/** Switching tabs keeps the period and the branch; the dentist stays on Operational. */
export function switchTab(search: DashboardSearch, tab: DashboardTab): DashboardSearch {
  const { dentist: _dentist, tab: _tab, ...kept } = search;
  return tab === 'operational' ? { ...kept, tab: 'operational' } : kept;
}

/** The query string of a card's request. */
export function queryString(query: DashboardQuery): string {
  const params = new URLSearchParams({ period: query.period });
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.branchId) params.set('branchId', query.branchId);
  if (query.dentistId) params.set('dentistId', query.dentistId);
  return params.toString();
}
