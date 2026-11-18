import { addDays, type DashboardQuery, type DateSpan, lastDayOfMonth } from '@dcm/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { MarkLink } from '@/components/charts';

/**
 * Where a number leads (feature 19, D6): the screen that owns the rows, filtered to the same
 * period, branch and dentist. Each target is a route and its search, as that screen's URL takes
 * it; Back returns to the dashboard as it was (the filters are in its URL).
 */
export interface DrillTarget {
  to: string;
  search?: Record<string, unknown>;
  params?: Record<string, string>;
}

/** The target as a link around a tile or a mark. */
export function linkTo(target: DrillTarget | null | undefined): MarkLink | undefined {
  if (!target) return undefined;
  return (content: ReactNode, className: string) => (
    <Link
      to={target.to as never}
      search={(target.search ?? {}) as never}
      params={(target.params ?? {}) as never}
      className={className}
    >
      {content}
    </Link>
  );
}

const branchOf = (query: DashboardQuery) => query.branchId ?? 'all';

/** Visits with an entry charged in the span (Production, Discounts, Average per visit). */
export const chargedVisits = (
  span: DateSpan,
  query: DashboardQuery,
  extra: Record<string, unknown> = {},
): DrillTarget => ({
  to: '/visits',
  search: {
    range: 'all',
    branch: branchOf(query),
    chargedFrom: span.from,
    chargedTo: span.to,
    ...extra,
  },
});

/** Finished visits dated in the span (Operational's Visits, waits, types, dentists). */
export const finishedVisits = (
  span: DateSpan,
  query: DashboardQuery,
  extra: Record<string, unknown> = {},
): DrillTarget => ({
  to: '/visits',
  search: {
    range: 'all',
    from: span.from,
    to: span.to,
    branch: branchOf(query),
    finished: true,
    ...(query.dentistId ? { dentist: query.dentistId } : {}),
    ...extra,
  },
});

export const payments = (
  span: DateSpan,
  query: DashboardQuery,
  extra: Record<string, unknown> = {},
): DrillTarget => ({
  to: '/payments',
  search: {
    range: 'all',
    from: span.from,
    to: span.to,
    ...(query.branchId ? { branch: query.branchId } : {}),
    ...extra,
  },
});

export const receivables = (bucket?: string): DrillTarget => ({
  to: '/payments',
  search: { tab: 'outstanding', ...(bucket ? { bucket } : {}) },
});

export const expenses = (span: DateSpan, category?: string): DrillTarget => ({
  to: '/expenses',
  search: { from: span.from, to: span.to, ...(category ? { category } : {}) },
});

export const patient = (patientId: string): DrillTarget => ({
  to: '/patients/$patientId',
  params: { patientId },
});

export const cohort = (name: string, extra: Record<string, unknown> = {}): DrillTarget => ({
  to: '/patients',
  search: { cohort: name, ...extra },
});

/** The Schedule's List view for a span (a status, a weekday × hour cell, due only). */
export const scheduleList = (
  span: DateSpan,
  query: DashboardQuery,
  extra: Record<string, unknown> = {},
): DrillTarget => ({
  to: '/schedule',
  search: {
    list: true,
    from: span.from,
    to: span.to,
    ...(query.branchId ? { branch: query.branchId } : {}),
    ...(query.dentistId ? { dentist: query.dentistId } : {}),
    ...extra,
  },
});

export const weekSpan = (week: string): DateSpan => ({ from: week, to: addDays(week, 6) });
export const monthSpan = (month: string): DateSpan => ({
  from: `${month}-01`,
  to: lastDayOfMonth(month),
});
