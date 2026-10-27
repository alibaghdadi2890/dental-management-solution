import { ACTIVITY_AREAS, type PlatformAuditEntry, type PlatformTenant } from '@dcm/contracts';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { tenantsQuery, usersQuery } from '@/features/platform/platform-api';
import { ApiError } from '@/lib/api';
import { todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { platformActivityQuery, patientNamesQuery, visitNumbersQuery } from './activity-api';
import { PLATFORM_ACTIVITY_COLUMNS } from './activity-columns';
import { buildLookups } from './activity-lookups';
import { ActivityRow } from './activity-page';
import { ACTIVITY_RANGES, rangeStart } from './activity-search';
import {
  PLATFORM_ACTIVITY_DEFAULTS,
  type PlatformActivitySearch,
} from './platform-activity-search';
import type { Lookups } from './sentence';

/** The ids of one page of rows, per clinic: what that clinic's lookups are asked for. */
interface IdGroup {
  tenantId: string;
  patients: string[];
  visits: string[];
}

function idGroupsOf(pages: readonly { items: PlatformAuditEntry[] }[]): IdGroup[] {
  return pages.flatMap((page) => {
    const byTenant = new Map<string, IdGroup>();
    for (const entry of page.items) {
      const group = byTenant.get(entry.tenantId) ?? {
        tenantId: entry.tenantId,
        patients: [],
        visits: [],
      };
      if (entry.patientId) group.patients.push(entry.patientId);
      if (entry.visitId) group.visits.push(entry.visitId);
      byTenant.set(entry.tenantId, group);
    }
    return [...byTenant.values()];
  });
}

/**
 * Every clinic's Activity, for platform admins (ADR-0057) — useful while clinics are few and
 * being tested. The clinic's own rows and sentences, with the clinic as a column; narrowed to one
 * clinic, an area, a person of that clinic, and a date range. Each row's names come from its own
 * clinic, and its time is in that clinic's time zone. Its records are in a clinic the admin is not
 * inside, so they are named, not linked ("Manage in clinic" goes there).
 */
export function PlatformActivityPage({
  search,
  onSearch,
}: {
  search: PlatformActivitySearch;
  onSearch: (next: PlatformActivitySearch, options?: { replace?: boolean }) => void;
}) {
  const { t, i18n } = useTranslation(['activity', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const tenants = useQuery(tenantsQuery());
  const tenantById = useMemo(
    () => new Map((tenants.data ?? []).map((tenant) => [tenant.id, tenant])),
    [tenants.data],
  );
  const chosen = search.tenant === undefined ? undefined : tenantById.get(search.tenant);
  // A date range starts at a clinic's midnight: the chosen one's, else the admin's own.
  const timeZone = chosen?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const feed = useInfiniteQuery(
    platformActivityQuery({
      tenantId: search.tenant,
      area: search.area,
      actorUserId: search.tenant === undefined ? undefined : search.person,
      from: rangeStart(search.range, todayIn(timeZone), timeZone),
    }),
  );
  const pages = useMemo(() => feed.data?.pages ?? [], [feed.data]);
  const entries = useMemo(() => pages.flatMap((page) => page.items), [pages]);
  const groups = useMemo(() => idGroupsOf(pages), [pages]);
  const tenantIds = useMemo(
    () =>
      [
        ...new Set([
          ...entries.map((entry) => entry.tenantId),
          ...(search.tenant ? [search.tenant] : []),
        ]),
      ].sort(),
    [entries, search.tenant],
  );

  const patients = useQueries({
    queries: groups.map((group) => patientNamesQuery(group.patients, group.tenantId)),
    combine: (results) => results.map((result) => result.data ?? []),
  });
  const visits = useQueries({
    queries: groups.map((group) => visitNumbersQuery(group.visits, group.tenantId)),
    combine: (results) => results.map((result) => result.data ?? []),
  });
  const staff = useQueries({
    queries: tenantIds.map((tenantId) => usersQuery(tenantId)),
    combine: (results) =>
      new Map(
        tenantIds.map((tenantId, index) => [
          tenantId,
          new Map((results[index]?.data ?? []).map((user) => [user.id, user.displayName])),
        ]),
      ),
  });

  const lookupsByTenant = useMemo(() => {
    const result = new Map<string, Lookups>();
    for (const tenantId of tenantIds) {
      const tenant = tenantById.get(tenantId);
      result.set(
        tenantId,
        buildLookups({
          patients: groups.flatMap((group, index) =>
            group.tenantId === tenantId ? (patients[index] ?? []) : [],
          ),
          visits: groups.flatMap((group, index) =>
            group.tenantId === tenantId ? (visits[index] ?? []) : [],
          ),
          staff: staff.get(tenantId) ?? new Map<string, string>(),
          notation: tenant?.toothNotation ?? 'fdi',
          locale,
          i18n,
        }),
      );
    }
    return result;
  }, [tenantIds, tenantById, groups, patients, visits, staff, locale, i18n]);

  const set = (patch: Partial<PlatformActivitySearch>) => {
    onSearch({ ...search, ...patch }, { replace: true });
  };
  const clinics = [...(tenants.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, locale));
  const people = [...(staff.get(search.tenant ?? '') ?? new Map<string, string>())].sort(
    ([, a], [, b]) => a.localeCompare(b, locale),
  );
  const filtered =
    search.tenant !== undefined ||
    search.area !== undefined ||
    search.range !== PLATFORM_ACTIVITY_DEFAULTS.range;

  let body: ReactNode;
  if (feed.isPending || tenants.isPending) {
    body = <SkeletonRows columns={PLATFORM_ACTIVITY_COLUMNS} label={t('loading')} />;
  } else if (feed.isError && entries.length === 0) {
    body = (
      <ErrorState
        title={t('error.title')}
        body={t('error.body')}
        requestId={feed.error instanceof ApiError ? feed.error.requestId : undefined}
        error={feed.error}
        onRetry={() => void feed.refetch()}
      />
    );
  } else if (entries.length === 0) {
    body = <EmptyState title={t('empty.title')} body={t('empty.body')} />;
  } else {
    body = (
      <div role="rowgroup">
        {entries.map((entry) => {
          const tenant: PlatformTenant | undefined = tenantById.get(entry.tenantId);
          const lookups = lookupsByTenant.get(entry.tenantId);
          if (!lookups) return null;
          return (
            <ActivityRow
              key={entry.id}
              entry={entry}
              lookups={lookups}
              tenant={{
                timeZone: tenant?.timeZone ?? timeZone,
                currency: tenant?.currency ?? 'USD',
              }}
              locale={locale}
              clinic={tenant?.name ?? t('platform.unknownClinic')}
            />
          );
        })}
      </div>
    );
  }

  return (
    <Page title={t('platform.title')} subtitle={t('platform.subtitle')}>
      <div role="group" aria-label={t('filters.area')} className="mb-3 flex flex-wrap gap-1.5">
        {/* A clinic's compensation is never shown across clinics (ADR-0060). */}
        {[undefined, ...ACTIVITY_AREAS.filter((area) => area !== 'compensation')].map((area) => {
          const on = search.area === area;
          return (
            <button
              key={area ?? 'all'}
              type="button"
              aria-pressed={on}
              onClick={() => {
                set({ area });
              }}
              className={cn(
                'h-[30px] cursor-pointer rounded-[15px] border px-3 text-[12.5px] leading-none font-medium',
                on
                  ? 'border-ink bg-ink text-white'
                  : 'border-border-control bg-surface text-ink-secondary hover:border-ink hover:text-ink',
              )}
            >
              {area === undefined ? t('areas.all') : t(`areas.${area}`)}
            </button>
          );
        })}
      </div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <FilterChip
          label={t('platform.clinic')}
          value={search.tenant ?? ''}
          options={[
            { value: '', label: t('platform.anyClinic') },
            ...clinics.map((clinic) => ({ value: clinic.id, label: clinic.name })),
          ]}
          onChange={(tenant) => {
            set({ tenant: tenant === '' ? undefined : tenant, person: undefined });
          }}
        />
        {search.tenant !== undefined && (
          <FilterChip
            label={t('filters.person')}
            value={search.person ?? ''}
            options={[
              { value: '', label: t('filters.anyone') },
              ...people.map(([id, name]) => ({ value: id, label: name })),
            ]}
            onChange={(person) => {
              set({ person: person === '' ? undefined : person });
            }}
          />
        )}
        <FilterChip
          label={t('filters.date')}
          value={search.range === PLATFORM_ACTIVITY_DEFAULTS.range ? '' : search.range}
          options={ACTIVITY_RANGES.map((range) => ({
            value: range === PLATFORM_ACTIVITY_DEFAULTS.range ? '' : range,
            label: t(`ranges.${range}`),
          }))}
          onChange={(range) => {
            set({
              range:
                ACTIVITY_RANGES.find((known) => known === range) ??
                PLATFORM_ACTIVITY_DEFAULTS.range,
            });
          }}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onSearch({ ...PLATFORM_ACTIVITY_DEFAULTS }, { replace: true });
            }}
          >
            {t('clear')}
          </Button>
        )}
      </div>
      <TableCard
        minWidth={1000}
        footer={
          entries.length > 0 && (feed.hasNextPage || feed.isFetchNextPageError) ? (
            <div className="flex items-center justify-center gap-3 border-t border-border px-3 py-2.5">
              {feed.isFetchNextPageError && !feed.isFetchingNextPage && (
                <span role="alert" className="text-[12.5px] text-ink-muted">
                  {t('moreFailed')}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                busy={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {feed.isFetchNextPageError ? t('common:tryAgain') : t('more')}
              </Button>
            </div>
          ) : undefined
        }
      >
        <div role="table" aria-label={t('platform.title')}>
          <TableHead
            columns={PLATFORM_ACTIVITY_COLUMNS}
            labels={[
              t('columns.when'),
              t('platform.clinic'),
              t('columns.who'),
              t('columns.what'),
              t('columns.reason'),
              <span key="expand" className="sr-only">
                {t('columns.details')}
              </span>,
            ]}
          />
          {body}
        </div>
      </TableCard>
    </Page>
  );
}
