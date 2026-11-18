import {
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  type DashboardTab,
  resolvePeriod,
  type Session,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateInput } from '@/components/ui/date-input';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { practitionersQuery } from '@/features/users/users-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { dateInputOrder, formatDateTime, formatTime, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type DashboardSearch, queryOf, switchTab, tabOf } from './dashboard-search';
import { dashboardKeys } from './dashboards-api';
import { formatSpan } from './format-span';
import { FinancialTab } from './financial-tab';
import { OperationalTab } from './operational-tab';

/** The oldest fetch time of the dashboard's cards (_Updated 14:32_), kept current. */
function useUpdatedAt(tenantId: string | null): number | null {
  const client = useQueryClient();
  const read = () => {
    const times = client
      .getQueryCache()
      .findAll({ queryKey: dashboardKeys.all(tenantId) })
      .map((query) => query.state.dataUpdatedAt)
      .filter((time) => time > 0);
    return times.length > 0 ? Math.min(...times) : null;
  };
  const [updated, setUpdated] = useState(read);
  useEffect(
    () =>
      client.getQueryCache().subscribe(() => {
        // The cache notifies while a card is rendering its query: update after it.
        queueMicrotask(() => {
          setUpdated(read());
        });
      }),
    // `read` reads the cache of this client and tenant only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, tenantId],
  );
  return updated;
}

/**
 * The Dashboard (feature 19): a Financial and an Operational tab, each shown with its capability
 * (`dashboard:financial`, `dashboard:operational`). One sticky filter row — period, branch and, on
 * Operational, dentist — all in the URL. Every card loads by itself; nothing refreshes by itself.
 */
export function DashboardPage({
  session,
  search,
  onSearch,
}: {
  session: Session;
  search: DashboardSearch;
  onSearch: (next: DashboardSearch) => void;
}) {
  const { t, i18n } = useTranslation('dashboards');
  const client = useQueryClient();
  const tenant = session.tenant;
  const tenantId = actingTenantId() ?? tenant?.id ?? null;
  const updatedAt = useUpdatedAt(tenantId);
  const can = (permission: Session['permissions'][number]) =>
    session.permissions.includes(permission);
  const tabs = (
    [
      can('dashboard:financial') && { key: 'financial' as const, label: t('tabs.financial') },
      can('dashboard:operational') && { key: 'operational' as const, label: t('tabs.operational') },
    ] as const
  ).filter((tab): tab is { key: DashboardTab; label: string } => Boolean(tab));
  const requested = tabOf(search);
  const tab = tabs.some((entry) => entry.key === requested) ? requested : tabs[0]?.key;
  const practitioners = useQuery({
    ...practitionersQuery(),
    enabled: tab === 'operational' && can('user:read'),
  });
  if (!tenant || !tab) return null;

  const effective: DashboardSearch = tab === requested ? search : switchTab(search, tab);
  const query = queryOf(effective);
  const today = todayIn(tenant.timeZone);
  const period = resolvePeriod(query, today) ?? resolvePeriod({ period: 'this_month' }, today);
  const locale = i18n.language;
  const patch = (next: Partial<DashboardSearch>) => {
    onSearch({ ...effective, ...next });
  };
  const periodValue: DashboardPeriod = effective.period ?? 'this_month';

  return (
    <TooltipProvider delayDuration={150}>
      <div className="h-full overflow-auto print:h-auto print:overflow-visible">
        <div className="dashboard-print px-[26px] pt-6 pb-10 print:px-0 print:pt-0">
          <div className="mb-2 hidden print:block">
            <div className="text-[16px] font-semibold">{tenant.name}</div>
            <div className="text-[12px] text-ink-muted">
              {period ? formatSpan(period, locale) : ''} ·{' '}
              {t('print.printed', {
                at: formatDateTime(new Date(), { timeZone: tenant.timeZone, locale }),
              })}
            </div>
          </div>
          <h1 className="mb-3 text-[21px] leading-tight font-semibold tracking-[-0.02em] print:hidden">
            {t('title')}
          </h1>
          {tabs.length > 1 && (
            <Tabs
              idBase="dashboard"
              label={t('tabs.label')}
              tabs={tabs}
              active={tab}
              onChange={(key) => {
                onSearch(switchTab(effective, key));
              }}
              className="border-b border-border print:hidden"
            />
          )}
          <div className="sticky top-0 z-20 -mx-[26px] mb-4 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-[26px] py-2.5 backdrop-blur-[2px] print:hidden">
            <FilterSelect
              label={t('filters.period')}
              value={periodValue}
              options={DASHBOARD_PERIODS.map((value) => ({
                value,
                label: t(`periods.${value}`),
              }))}
              onChange={(value) => {
                const next = value as DashboardPeriod;
                patch({
                  period: next === 'this_month' ? undefined : next,
                  from: next === 'custom' ? (period?.from ?? today) : undefined,
                  to: next === 'custom' ? (period?.to ?? today) : undefined,
                });
              }}
            />
            {periodValue === 'custom' && (
              <CustomRange
                from={effective.from ?? today}
                to={effective.to ?? today}
                today={today}
                country={tenant.country}
                onChange={(from, to) => {
                  patch({ from, to });
                }}
              />
            )}
            {session.branches.length > 1 && (
              <FilterSelect
                label={t('filters.branch')}
                value={effective.branch ?? ''}
                options={[
                  { value: '', label: t('filters.allBranches') },
                  ...session.branches.map((branch) => ({ value: branch.id, label: branch.name })),
                ]}
                onChange={(value) => {
                  patch({ branch: value || undefined });
                }}
              />
            )}
            {tab === 'operational' && practitioners.data && practitioners.data.length > 1 && (
              <FilterSelect
                label={t('filters.dentist')}
                value={effective.dentist ?? ''}
                options={[
                  { value: '', label: t('filters.allDentists') },
                  ...practitioners.data.map((dentist) => ({
                    value: dentist.id,
                    label: dentist.displayName,
                  })),
                ]}
                onChange={(value) => {
                  patch({ dentist: value || undefined });
                }}
              />
            )}
            {period && (
              <span className="text-[12px] text-ink-muted">
                {t('filters.span', {
                  span: formatSpan(period, locale),
                  compare: formatSpan(period.compare, locale),
                })}
              </span>
            )}
            <span className="ms-auto flex items-center gap-1.5 text-[12px] text-ink-muted">
              {updatedAt !== null &&
                t('filters.updated', {
                  time: formatTime(new Date(updatedAt), { timeZone: tenant.timeZone, locale }),
                })}
              <button
                type="button"
                aria-label={t('filters.refresh')}
                title={t('filters.refresh')}
                onClick={() => {
                  void client.invalidateQueries({ queryKey: dashboardKeys.all(tenantId) });
                }}
                className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
              >
                <svg
                  aria-hidden
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
                </svg>
              </button>
            </span>
          </div>
          {period && (
            <TabPanel idBase="dashboard" tabKey={tab} className="outline-none">
              {tab === 'financial' ? (
                <FinancialTab session={session} query={query} period={period} />
              ) : (
                <OperationalTab session={session} query={query} period={period} />
              )}
            </TabPanel>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/** A labelled select of the filter row. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label
      className={cn(
        'flex h-[34px] items-center gap-1.5 rounded-lg border border-border-control bg-surface ps-[11px] pe-1.5',
      )}
    >
      <span className="text-[12px] leading-none whitespace-nowrap text-ink-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="cursor-pointer border-none bg-transparent pe-0.5 text-[12.5px] leading-none font-medium outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The custom period's two dates; a change applies once both are whole dates in order. */
function CustomRange({
  from,
  to,
  today,
  country,
  onChange,
}: {
  from: string;
  to: string;
  today: string;
  country: string;
  onChange: (from: string, to: string) => void;
}) {
  const { t } = useTranslation('dashboards');
  const order = dateInputOrder(country);
  const valid = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return (
    <span className="flex items-center gap-1.5">
      <DateInput
        value={from}
        order={order}
        today={today}
        aria-label={t('filters.from')}
        pickerLabel={t('filters.pickFrom')}
        className="h-[34px] w-[140px]"
        onChange={(value) => {
          if (valid(value) && value <= to) onChange(value, to);
        }}
      />
      <span aria-hidden className="text-ink-muted">
        {'–'}
      </span>
      <DateInput
        value={to}
        order={order}
        today={today}
        aria-label={t('filters.to')}
        pickerLabel={t('filters.pickTo')}
        className="h-[34px] w-[140px]"
        onChange={(value) => {
          if (valid(value) && value >= from) onChange(from, value);
        }}
      />
    </span>
  );
}
