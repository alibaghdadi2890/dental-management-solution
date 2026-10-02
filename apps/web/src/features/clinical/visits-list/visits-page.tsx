import { exportLanguageSchema, type Session, VISIT_RANGES } from '@dcm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  SearchInput,
  SkeletonRows,
  TableCard,
  ViewTabs,
} from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { branchRoomsQuery } from '@/features/tenancy/tenancy-api';
import { useStaffNames } from '@/features/users/use-staff-names';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { VisitDetailPanel } from './visit-detail-panel';
import {
  downloadVisitsExport,
  unpaidSummaryQuery,
  visitBalancesQuery,
  visitListSummaryQuery,
  visitPageQuery,
} from './visits-list-api';
import {
  activeFilterCount,
  clearFilters,
  filtersOf,
  listQueryOf,
  VISIT_PAGE_SIZES,
  VISIT_TABS,
  type VisitsSearch,
} from './visits-search';
import { VISIT_COLUMNS, VISIT_TABLE_MIN_WIDTH, VisitRow, VisitsTableHead } from './visits-table';

const SEARCH_DEBOUNCE_MS = 250;

type Tenant = NonNullable<Session['tenant']>;

interface VisitsPageProps {
  search: VisitsSearch;
  onSearch: (next: VisitsSearch, options?: { replace?: boolean }) => void;
}

/** The debounced search box: commits to the URL 250ms after typing stops. */
function VisitSearchBox({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const { t } = useTranslation('visits');
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== text.trim()) setText(value);
  }
  const commit = useEffectEvent(onCommit);
  useEffect(() => {
    const next = text.trim();
    if (next === value) return undefined;
    const timer = setTimeout(() => {
      commit(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text, value]);
  return (
    <SearchInput
      value={text}
      onChange={setText}
      placeholder={t('search.placeholder')}
      label={t('search.label')}
      maxLength={100}
    />
  );
}

/**
 * The clinic-wide Visits screen (4b, spec §Visits page): the session branch's visits, newest
 * first, cursor-paged (D12); tabs, filters and the open visit live in the URL, the cursor stack
 * in state (a filter change starts again from the first page). The detail panel pushes the list.
 */
export function VisitsPage(props: VisitsPageProps) {
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  return <VisitsList {...props} tenant={session.tenant} branchId={session.branch?.id ?? null} />;
}

function VisitsList({
  search,
  onSearch,
  tenant,
  branchId,
}: VisitsPageProps & { tenant: Tenant; branchId: string | null }) {
  const { t, i18n } = useTranslation(['visits', 'common']);
  const toast = useToast();
  const canPay = usePermission('payment:read');
  const locale = i18n.resolvedLanguage ?? 'en';
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);
  const { practitioners } = useStaffNames();
  const rooms = useQuery({
    ...branchRoomsQuery(branchId ?? ''),
    enabled: branchId !== null,
  });

  // Unpaid needs `payment:read`; without it the tab falls back to All.
  const tab = search.tab === 'unpaid' && !canPay ? 'all' : search.tab;
  const unpaid = tab === 'unpaid';
  const effective = { ...search, tab };
  const filters = filtersOf(effective);
  const filterKey = JSON.stringify([tab, filters, search.size]);
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key: filterKey,
    cursors: [undefined],
  });
  const cursors = pages.key === filterKey ? pages.cursors : [undefined];
  const cursor = cursors.at(-1);

  const list = useQuery({
    ...visitPageQuery(listQueryOf(effective, cursor), unpaid),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery(visitListSummaryQuery(filters));
  const unpaidSummary = useQuery(unpaidSummaryQuery(filters, canPay));
  const items = list.data?.items ?? [];
  const balances = useQuery(
    visitBalancesQuery(
      items.map((visit) => visit.id),
      canPay,
    ),
  );
  const balanceById = new Map((balances.data ?? []).map((balance) => [balance.visitId, balance]));
  const stale = list.isPlaceholderData;

  const set = (patch: Partial<VisitsSearch>, options?: { replace?: boolean }) => {
    onSearch({ ...search, ...patch }, options);
  };

  const [exporting, setExporting] = useState(false);
  const runExport = () => {
    setExporting(true);
    downloadVisitsExport(tab, filters, exportLanguageSchema.safeParse(locale).data)
      .catch((error: unknown) => {
        const reason =
          error instanceof ApiError ? apiErrorMessage(error, i18n) : t('common:unexpected');
        toast(t('exportFailed', { reason }), { tone: 'danger' });
      })
      .finally(() => {
        setExporting(false);
      });
  };

  const tabs = summary.data?.tabs;
  const tabCounts = {
    all: tabs?.all,
    in_progress: tabs?.inProgress,
    unpaid: unpaidSummary.data?.tabCount,
    voided_amended: tabs?.voidedAmended,
  };
  const footerFigures = unpaid ? unpaidSummary.data : summary.data;
  const open = items.find((visit) => visit.id === search.visit);

  let subtitle = t('subtitleLoading');
  if (tabs) {
    const today = t('subtitleToday', { count: tabs.today });
    subtitle =
      unpaidSummary.data === undefined
        ? today
        : t('subtitle', {
            today,
            unpaid: t('subtitleUnpaid', { count: unpaidSummary.data.tabCount }),
          });
  }

  let body;
  if (list.isPending) {
    body = <SkeletonRows columns={VISIT_COLUMNS} rows={8} label={t('states.loading')} />;
  } else if (list.isError && !list.data) {
    body = (
      <ErrorState
        title={t('states.errorTitle')}
        body={t('states.errorBody')}
        requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (items.length === 0) {
    body =
      activeFilterCount(effective) > 0 || tab !== 'all' ? (
        <EmptyState
          title={t('states.noMatchTitle')}
          body={t('states.noMatchBody')}
          action={
            activeFilterCount(effective) > 0 ? (
              <Button
                variant="outline"
                onClick={() => {
                  onSearch(clearFilters(search));
                }}
              >
                {t('filters.clear')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <EmptyState title={t('states.emptyTitle')} body={t('states.emptyBody')} />
      );
  } else {
    const context = {
      timeZone: tenant.timeZone,
      locale,
      canPay,
      receivedAt: list.dataUpdatedAt,
    };
    body = items.map((visit) => (
      <VisitRow
        key={visit.id}
        visit={visit}
        context={context}
        balance={balanceById.get(visit.id)}
        balanceLoading={balances.isPending && canPay}
        open={visit.id === search.visit}
        stale={stale}
        onOpen={() => {
          set({ visit: visit.id }, { replace: search.visit !== undefined });
        }}
      />
    ));
  }

  const footer =
    items.length > 0 ? (
      <div className="flex flex-wrap items-center gap-3.5 border-t border-border bg-faint px-3 py-2.5">
        <span className="text-[12.5px] leading-none text-ink-secondary">
          {footerFigures
            ? [
                t('footer.count', {
                  count: footerFigures.count,
                  formatted: count(footerFigures.count),
                }),
                ...footerFigures.billed.map((billed) =>
                  t('footer.billed', { amount: formatMoney(billed, locale) }),
                ),
              ].join(' · ')
            : ' '}
        </span>
        <label className="flex items-center gap-1.5 text-[12.5px] leading-none text-ink-secondary">
          {t('footer.rows')}
          <select
            value={search.size}
            onChange={(event) => {
              const size = VISIT_PAGE_SIZES.find((option) => String(option) === event.target.value);
              if (size) set({ size });
            }}
            className="h-7 cursor-pointer rounded-md border border-border-control bg-surface px-1 font-mono text-[12.5px] leading-none font-medium"
          >
            {VISIT_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label={t('footer.label')} className="ms-auto flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={cursors.length <= 1 || stale}
            onClick={() => {
              setPages({ key: filterKey, cursors: cursors.slice(0, -1) });
            }}
          >
            {t('footer.previous')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!list.data?.nextCursor || stale}
            onClick={() => {
              const next = list.data?.nextCursor;
              if (next) setPages({ key: filterKey, cursors: [...cursors, next] });
            }}
          >
            {t('footer.next')}
          </Button>
        </nav>
      </div>
    ) : undefined;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">
        <Page
          title={t('title')}
          subtitle={subtitle}
          actions={
            canPay ? (
              <Button variant="outline" busy={exporting} onClick={runExport}>
                {t('exportCsv')}
              </Button>
            ) : undefined
          }
        >
          <ViewTabs
            label={t('tabs.label')}
            active={tab}
            onChange={(next) => {
              set({ tab: next, visit: undefined });
            }}
            tabs={VISIT_TABS.filter((key) => canPay || key !== 'unpaid').map((key) => {
              const value = tabCounts[key];
              return {
                key,
                label: t(`tabs.${key}`),
                count: value === undefined ? undefined : count(value),
              };
            })}
          />
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <VisitSearchBox
              value={search.q ?? ''}
              onCommit={(q) => {
                set({ q: q || undefined }, { replace: true });
              }}
            />
            <FilterChip
              label={t('filters.date')}
              value={search.range === '90d' ? '' : search.range}
              options={VISIT_RANGES.map((range) => ({
                value: range === '90d' ? '' : range,
                label: t(`filters.range.${range}`),
              }))}
              onChange={(value) => {
                const range = VISIT_RANGES.find((candidate) => candidate === value) ?? '90d';
                set({ range });
              }}
            />
            <FilterChip
              label={t('filters.dentist')}
              value={search.dentist ?? ''}
              options={[
                { value: '', label: t('filters.any') },
                ...(practitioners ?? []).map((p) => ({ value: p.id, label: p.displayName })),
              ]}
              onChange={(value) => {
                set({ dentist: value || undefined });
              }}
            />
            <FilterChip
              label={t('filters.room')}
              value={search.room ?? ''}
              options={[
                { value: '', label: t('filters.any') },
                ...(rooms.data ?? []).map((room) => ({ value: room.id, label: room.name })),
              ]}
              onChange={(value) => {
                set({ room: value || undefined });
              }}
            />
            {activeFilterCount(effective) > 0 && (
              <Button
                variant="ghost"
                className="px-2.5"
                onClick={() => {
                  onSearch(clearFilters(search));
                }}
              >
                {t('filters.clear')}
              </Button>
            )}
          </div>
          <TableCard minWidth={VISIT_TABLE_MIN_WIDTH} footer={footer}>
            <div role="table" aria-label={t('columns.table')} aria-busy={stale}>
              <VisitsTableHead />
              {body}
            </div>
          </TableCard>
        </Page>
      </div>
      {open && (
        <VisitDetailPanel
          key={`${open.id}:${open.updatedAt}`}
          visit={open}
          balance={balanceById.get(open.id)}
          canPay={canPay}
          timeZone={tenant.timeZone}
          locale={locale}
          onClose={() => {
            set({ visit: undefined }, { replace: true });
          }}
        />
      )}
    </div>
  );
}
