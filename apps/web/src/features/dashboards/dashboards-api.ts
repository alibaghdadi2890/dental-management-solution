import {
  type DashboardQuery,
  financialCostsSchema,
  financialDentistsSchema,
  financialMoneySchema,
  financialOwesSchema,
  financialStockSchema,
  financialPlansSchema,
  financialReceivablesSchema,
  financialServicesSchema,
  operationalAppointmentsSchema,
  operationalAttentionSchema,
  operationalBusyHoursSchema,
  operationalDentistsSchema,
  operationalFollowUpsSchema,
  operationalLabsSchema,
  operationalPatientsSchema,
  operationalPlansSchema,
  operationalVisitsSchema,
} from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { queryString } from './dashboard-search';

/** Data is cached for a few minutes; nothing refreshes by itself (D2, D9). */
const STALE_MS = 5 * 60_000;

/** Each card's route and schema; a card is one request, so it loads and fails on its own. */
const CARDS = {
  'financial/money': financialMoneySchema,
  'financial/costs': financialCostsSchema,
  'financial/receivables': financialReceivablesSchema,
  'financial/dentists': financialDentistsSchema,
  'financial/services': financialServicesSchema,
  'financial/plans': financialPlansSchema,
  'financial/owes': financialOwesSchema,
  'financial/stock': financialStockSchema,
  'operational/appointments': operationalAppointmentsSchema,
  'operational/busy-hours': operationalBusyHoursSchema,
  'operational/visits': operationalVisitsSchema,
  'operational/patients': operationalPatientsSchema,
  'operational/plans': operationalPlansSchema,
  'operational/dentists': operationalDentistsSchema,
  'operational/labs': operationalLabsSchema,
  'operational/follow-ups': operationalFollowUpsSchema,
  'operational/attention': operationalAttentionSchema,
} as const;

export type DashboardCard = keyof typeof CARDS;

/** The cards that ignore the period (now figures): their key leaves the filter out. */
const NOW_CARDS: ReadonlySet<DashboardCard> = new Set([
  'financial/receivables',
  'financial/plans',
  'financial/owes',
]);

export const dashboardKeys = {
  all: (tenantId: string | null) => ['dashboards', tenantId] as const,
  card: (tenantId: string | null, card: DashboardCard, query: DashboardQuery | null) =>
    [...dashboardKeys.all(tenantId), card, query] as const,
};

/** `GET /dashboards/<card>` for the filter (feature 19). */
export function cardQuery<TCard extends DashboardCard>(card: TCard, query: DashboardQuery) {
  const now = NOW_CARDS.has(card);
  return queryOptions({
    queryKey: dashboardKeys.card(actingTenantId(), card, now ? null : query),
    queryFn: () =>
      apiFetch(`/dashboards/${card}${now ? '' : `?${queryString(query)}`}`, CARDS[card]) as Promise<
        z.infer<(typeof CARDS)[TCard]>
      >,
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
