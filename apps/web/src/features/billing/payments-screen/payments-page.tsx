import {
  AGING_BUCKETS,
  type AgingBucket,
  exportLanguageSchema,
  formatReceiptNumber,
  formatVisitNumber,
  type OutstandingItem,
  PAYMENT_METHODS,
  PAYMENT_RANGES,
  type Receivables,
  toCents,
  type Transaction,
} from '@dcm/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  Pill,
  SearchInput,
  SkeletonRows,
  TableCard,
  TableHead,
  ViewTabs,
} from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { invalidateVisitData } from '@/features/clinical/visits-list/visits-list-api';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AdjustBalanceMenu } from '../adjust/adjust-entry';
import { useRecordPayment } from '../payments/payment-dialog-context';
import {
  agingQuery,
  downloadTransactionsExport,
  openPrintable,
  outstandingQuery,
  printPath,
  transactionsQuery,
  voidPayment,
} from '../payments-api';
import {
  activeFilterCount,
  clearFilters,
  outstandingQueryOf,
  PAYMENT_PAGE_SIZES,
  PAYMENT_TABS,
  type PaymentsSearch,
  toggleBucket,
  transactionFiltersOf,
  transactionQueryOf,
} from './payments-search';
import { RefundDialog } from './refund-dialog';

const SEARCH_DEBOUNCE_MS = 250;

const TRANSACTION_COLUMNS =
  '92px 100px minmax(170px,1.3fr) 140px minmax(100px,1fr) 128px 100px 256px';
const OUTSTANDING_COLUMNS = 'minmax(200px,1.5fr) 128px 80px 112px 120px 168px';

/** POC aging colours: 0–30 → 90+. */
const BUCKET_COLOURS: Record<AgingBucket, string> = {
  d0_30: '#c3c7ea',
  d31_60: '#e0c58f',
  d61_90: '#d99a7e',
  d90_plus: '#9b2c2c',
};

interface PaymentsPageProps {
  search: PaymentsSearch;
  onSearch: (next: PaymentsSearch, options?: { replace?: boolean }) => void;
}

function SearchBox({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const { t } = useTranslation('payments');
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
 * The Payments screen (feature 5 §Screens 2, POC Payments): KPI cards (Collected · 30 days,
 * Outstanding, Refunds · 30 days), the receivables aging bar with its bucket buttons, and two
 * tabs — Transactions (filters, cursor pager, CSV export, receipt / refund / void) and
 * Outstanding (owing patients by oldest unpaid charge, Take payment). Tabs and filters live in
 * the URL, the cursor stack in state.
 */
export function PaymentsPage({ search, onSearch }: PaymentsPageProps) {
  const { t, i18n } = useTranslation(['payments', 'billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const aging = useQuery(agingQuery());
  const set = (patch: Partial<PaymentsSearch>, options?: { replace?: boolean }) => {
    onSearch({ ...search, ...patch }, options);
  };

  const [exporting, setExporting] = useState(false);
  const runExport = () => {
    setExporting(true);
    downloadTransactionsExport(
      transactionFiltersOf(search),
      exportLanguageSchema.safeParse(locale).data,
    )
      .catch((error: unknown) => {
        const reason =
          error instanceof ApiError ? apiErrorMessage(error, i18n) : t('common:unexpected');
        toast(t('exportFailed', { reason }), { tone: 'danger' });
      })
      .finally(() => {
        setExporting(false);
      });
  };

  return (
    <Page
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        search.tab === 'transactions' ? (
          <Button variant="outline" busy={exporting} onClick={runExport}>
            {t('exportCsv')}
          </Button>
        ) : undefined
      }
    >
      <Kpis receivables={aging.data} locale={locale} />
      <AgingCard
        receivables={aging.data}
        locale={locale}
        active={search.tab === 'outstanding' ? search.bucket : undefined}
        onBucket={(bucket) => {
          onSearch(toggleBucket(search, bucket));
        }}
      />
      <ViewTabs
        label={t('tabs.label')}
        active={search.tab}
        onChange={(tab) => {
          set({ tab });
        }}
        tabs={PAYMENT_TABS.map((key) => ({ key, label: t(`tabs.${key}`) }))}
      />
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <SearchBox
          value={search.q ?? ''}
          onCommit={(q) => {
            set({ q: q || undefined }, { replace: true });
          }}
        />
        {search.tab === 'transactions' ? (
          <>
            <FilterChip
              label={t('filters.date')}
              value={search.range === '30d' ? '' : search.range}
              options={PAYMENT_RANGES.map((range) => ({
                value: range === '30d' ? '' : range,
                label: t(`filters.range.${range}`),
              }))}
              onChange={(value) => {
                set({ range: PAYMENT_RANGES.find((range) => range === value) ?? '30d' });
              }}
            />
            <FilterChip
              label={t('filters.method')}
              value={search.method ?? ''}
              options={[
                { value: '', label: t('filters.any') },
                ...PAYMENT_METHODS.map((method) => ({
                  value: method,
                  label: t(`billing:methods.${method}`),
                })),
              ]}
              onChange={(value) => {
                set({ method: PAYMENT_METHODS.find((method) => method === value) });
              }}
            />
          </>
        ) : (
          <>
            <FilterChip
              label={t('filters.bucket')}
              value={search.bucket ?? ''}
              options={[
                { value: '', label: t('filters.any') },
                ...AGING_BUCKETS.map((bucket) => ({
                  value: bucket,
                  label: t(`buckets.${bucket}`),
                })),
              ]}
              onChange={(value) => {
                set({ bucket: AGING_BUCKETS.find((bucket) => bucket === value) });
              }}
            />
            <FilterChip
              label={t('filters.group')}
              value={search.group === 'payer' ? 'payer' : ''}
              options={[
                { value: '', label: t('filters.byPatient') },
                { value: 'payer', label: t('filters.byPayer') },
              ]}
              onChange={(value) => {
                set({ group: value === 'payer' ? 'payer' : 'patient' });
              }}
            />
          </>
        )}
        {activeFilterCount(search) > 0 && (
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
      {search.tab === 'transactions' ? (
        <TransactionsTable search={search} locale={locale} onSearch={onSearch} />
      ) : (
        <OutstandingTable search={search} locale={locale} onSearch={onSearch} />
      )}
    </Page>
  );
}

function Kpis({ receivables, locale }: { receivables: Receivables | undefined; locale: string }) {
  const { t } = useTranslation('payments');
  const money = (amount: string | undefined) =>
    receivables && amount !== undefined
      ? formatMoney({ amount, currency: receivables.currency }, locale)
      : '—';
  const cards: { key: 'collected' | 'outstanding' | 'refunds'; value: string; tone?: string }[] = [
    { key: 'collected', value: money(receivables?.collected30d) },
    { key: 'outstanding', value: money(receivables?.outstanding), tone: 'text-danger' },
    { key: 'refunds', value: money(receivables?.refunds30d) },
  ];
  return (
    <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
      {cards.map((card) => (
        <section key={card.key} className="rounded-xl border border-border bg-surface px-4 py-3.5">
          <h2 className="m-0 text-[12px] font-medium text-ink-muted">{t(`kpi.${card.key}`)}</h2>
          <p
            dir="ltr"
            className={cn('m-0 mt-2 font-mono text-[22px] font-semibold tabular-nums', card.tone)}
          >
            {card.value}
          </p>
        </section>
      ))}
    </div>
  );
}

function AgingCard({
  receivables,
  locale,
  active,
  onBucket,
}: {
  receivables: Receivables | undefined;
  locale: string;
  active: AgingBucket | undefined;
  onBucket: (bucket: AgingBucket) => void;
}) {
  const { t } = useTranslation('payments');
  const total = receivables
    ? receivables.buckets.reduce((sum, bucket) => sum + Number(bucket.amount), 0)
    : 0;
  return (
    <section className="mb-4 rounded-xl border border-border bg-surface px-4 py-3.5">
      <h2 className="m-0 mb-2.5 text-[13px] font-semibold">{t('aging.title')}</h2>
      <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
        {receivables?.buckets.map((bucket) =>
          total > 0 && Number(bucket.amount) > 0 ? (
            <span
              key={bucket.bucket}
              style={{
                width: `${(Number(bucket.amount) / total) * 100}%`,
                background: BUCKET_COLOURS[bucket.bucket],
              }}
            />
          ) : null,
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        {AGING_BUCKETS.map((key) => {
          const bucket = receivables?.buckets.find((candidate) => candidate.bucket === key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active === key}
              onClick={() => {
                onBucket(key);
              }}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-1 rounded-lg border px-3 py-2 text-start',
                active === key
                  ? 'border-primary bg-primary-tint'
                  : 'border-border bg-surface hover:border-ink',
              )}
            >
              <span className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ background: BUCKET_COLOURS[key] }}
                />
                {t(`buckets.${key}`)}
              </span>
              <span dir="ltr" className="font-mono text-[14px] font-semibold tabular-nums">
                {bucket && receivables
                  ? formatMoney({ amount: bucket.amount, currency: receivables.currency }, locale)
                  : '—'}
              </span>
              <span className="text-[11.5px] text-ink-muted">
                {t('aging.patients', { count: bucket?.patients ?? 0 })}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The cursor stack of one list: a filter change starts again from the first page. */
function useCursorStack(key: string) {
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[] }>({
    key,
    cursors: [undefined],
  });
  const cursors = pages.key === key ? pages.cursors : [undefined];
  return {
    cursor: cursors.at(-1),
    canBack: cursors.length > 1,
    back: () => {
      setPages({ key, cursors: cursors.slice(0, -1) });
    },
    next: (cursor: string) => {
      setPages({ key, cursors: [...cursors, cursor] });
    },
  };
}

function Pager({
  search,
  onSearch,
  canBack,
  nextCursor,
  stale,
  onBack,
  onNext,
}: {
  search: PaymentsSearch;
  onSearch: PaymentsPageProps['onSearch'];
  canBack: boolean;
  nextCursor: string | null | undefined;
  stale: boolean;
  onBack: () => void;
  onNext: (cursor: string) => void;
}) {
  const { t } = useTranslation('payments');
  return (
    <div className="flex flex-wrap items-center gap-3.5 border-t border-border bg-faint px-3 py-2.5">
      <label className="flex items-center gap-1.5 text-[12.5px] leading-none text-ink-secondary">
        {t('footer.rows')}
        <select
          value={search.size}
          onChange={(event) => {
            const size = PAYMENT_PAGE_SIZES.find((option) => String(option) === event.target.value);
            if (size) onSearch({ ...search, size });
          }}
          className="h-7 cursor-pointer rounded-md border border-border-control bg-surface px-1 font-mono text-[12.5px] leading-none font-medium"
        >
          {PAYMENT_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <nav aria-label={t('footer.label')} className="ms-auto flex items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={!canBack || stale} onClick={onBack}>
          {t('footer.previous')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!nextCursor || stale}
          onClick={() => {
            if (nextCursor) onNext(nextCursor);
          }}
        >
          {t('footer.next')}
        </Button>
      </nav>
    </div>
  );
}

function ListBody({
  isPending,
  error,
  empty,
  columns,
  onRetry,
  filtered,
  onClear,
  children,
}: {
  isPending: boolean;
  error: unknown;
  empty: boolean;
  columns: string;
  onRetry: () => void;
  filtered: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('payments');
  if (isPending) return <SkeletonRows columns={columns} rows={6} label={t('states.loading')} />;
  if (error)
    return (
      <ErrorState
        title={t('states.errorTitle')}
        body={t('states.errorBody')}
        requestId={error instanceof ApiError ? error.requestId : undefined}
        onRetry={onRetry}
      />
    );
  if (empty)
    return filtered ? (
      <EmptyState
        title={t('states.noMatchTitle')}
        body={t('states.noMatchBody')}
        action={
          <Button variant="outline" onClick={onClear}>
            {t('filters.clear')}
          </Button>
        }
      />
    ) : (
      <EmptyState title={t('states.emptyTitle')} body={t('states.emptyBody')} />
    );
  return children;
}

function TransactionsTable({
  search,
  locale,
  onSearch,
}: {
  search: PaymentsSearch;
  locale: string;
  onSearch: PaymentsPageProps['onSearch'];
}) {
  const { t } = useTranslation('payments');
  const pages = useCursorStack(JSON.stringify([transactionFiltersOf(search), search.size]));
  const list = useQuery({
    ...transactionsQuery(transactionQueryOf(search, pages.cursor)),
    placeholderData: keepPreviousData,
  });
  const [refunding, setRefunding] = useState<Transaction | null>(null);
  const items = list.data?.items ?? [];
  const stale = list.isPlaceholderData;
  return (
    <>
      <TableCard
        minWidth={1260}
        footer={
          items.length > 0 ? (
            <Pager
              search={search}
              onSearch={onSearch}
              canBack={pages.canBack}
              nextCursor={list.data?.nextCursor}
              stale={stale}
              onBack={pages.back}
              onNext={pages.next}
            />
          ) : undefined
        }
      >
        <div role="table" aria-label={t('columns.transactions')} aria-busy={stale}>
          <TableHead
            columns={TRANSACTION_COLUMNS}
            labels={[
              t('columns.date'),
              t('columns.receipt'),
              t('columns.patient'),
              t('columns.type'),
              t('columns.visits'),
              t('columns.recordedBy'),
              <span key="amount" className="block text-end">
                {t('columns.amount')}
              </span>,
              '',
            ]}
          />
          <ListBody
            isPending={list.isPending}
            error={list.isError && !list.data ? list.error : null}
            empty={items.length === 0}
            columns={TRANSACTION_COLUMNS}
            onRetry={() => void list.refetch()}
            filtered={activeFilterCount(search) > 0}
            onClear={() => {
              onSearch(clearFilters(search));
            }}
          >
            {items.map((item) => (
              <TransactionRow
                key={item.id}
                item={item}
                locale={locale}
                stale={stale}
                onRefund={() => {
                  setRefunding(item);
                }}
              />
            ))}
          </ListBody>
        </div>
      </TableCard>
      {refunding && (
        <RefundDialog
          payment={refunding}
          locale={locale}
          onClose={() => {
            setRefunding(null);
          }}
        />
      )}
    </>
  );
}

function TransactionRow({
  item,
  locale,
  stale,
  onRefund,
}: {
  item: Transaction;
  locale: string;
  stale: boolean;
  onRefund: () => void;
}) {
  const { t, i18n } = useTranslation(['payments', 'billing']);
  const canRefund = usePermission('payment:refund');
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const money = (amount: string) => formatMoney({ amount, currency: item.currency }, locale);
  const payment = item.kind === 'payment';
  const reversible = payment && !item.voided && toCents(item.refunded) < toCents(item.amount);
  const voidable = payment && !item.voided && toCents(item.refunded) === 0n;

  const startVoid = () => {
    confirm({
      title: t('void.title', { receipt: formatReceiptNumber(item.receiptNumber) }),
      body: t(item.householdGroupId ? 'void.bodyHousehold' : 'void.body', {
        amount: money(item.amount),
      }),
      okLabel: t('void.ok'),
      tone: 'danger',
      reasonLabel: t('void.reason'),
      onConfirm: async (reason) => {
        try {
          await voidPayment(item.id, { reason });
        } catch (error) {
          throw new Error(apiErrorMessage(error, i18n), { cause: error });
        }
        await invalidateVisitData(queryClient);
        toast(t('void.done', { receipt: formatReceiptNumber(item.receiptNumber) }), {
          tone: 'success',
        });
      },
    });
  };

  let type: ReactNode;
  if (item.kind === 'refund')
    type = <span className="font-medium text-danger">{t('type.refund')}</span>;
  else if (item.kind === 'void') type = <span className="text-ink-muted">{t('type.void')}</span>;
  else
    type = (
      <span className="flex flex-wrap items-center gap-1.5">
        <Pill tone="neutral">{t(`billing:methods.${item.method}`)}</Pill>
        {item.partial && <span className="text-[12px] text-ink-muted">{t('type.partial')}</span>}
      </span>
    );

  return (
    <div
      role="row"
      className={cn(
        'grid min-h-14 items-center gap-2.5 border-t border-row-divider bg-surface px-3 py-1.5 text-[12.5px]',
        (stale || item.voided || item.kind === 'void') && 'opacity-60',
      )}
      style={{ gridTemplateColumns: TRANSACTION_COLUMNS }}
    >
      <span role="cell" className="font-mono">
        {formatCalendarDate(item.paidAt, locale)}
      </span>
      <span role="cell" dir="ltr" className="font-mono text-ink-secondary">
        {formatReceiptNumber(item.receiptNumber)}
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-2">
        <Link
          to="/patients/$patientId"
          params={{ patientId: item.patient.id }}
          search={{ tab: 'balance' }}
          className="truncate font-medium text-ink hover:text-primary hover:underline"
        >
          {item.patient.fullName}
        </Link>
        {item.householdGroupId && <Pill tone="indigo">{t('household')}</Pill>}
      </span>
      <span role="cell">{type}</span>
      <span role="cell" dir="ltr" className="truncate font-mono text-ink-secondary">
        {item.visits.map((visit) => formatVisitNumber(visit.visitNumber)).join(', ') || '—'}
      </span>
      <span role="cell" className="truncate text-ink-secondary">
        {item.recordedBy.name ?? '—'}
      </span>
      <span
        role="cell"
        dir="ltr"
        className={cn(
          'text-end font-mono font-semibold',
          item.kind === 'refund' ? 'text-danger' : 'text-ink',
          item.voided && 'line-through',
        )}
      >
        {item.kind === 'payment' ? money(item.amount) : `−${money(item.amount)}`}
      </span>
      <span role="cell" className="flex items-center justify-end gap-1.5 whitespace-nowrap">
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5"
          onClick={() => {
            openPrintable(printPath.receipt(item.id));
          }}
        >
          {t('actions.receipt')}
        </Button>
        {reversible &&
          (canRefund ? (
            <>
              <Button variant="danger" size="sm" disabled={stale} onClick={onRefund}>
                {t('actions.refund')}
              </Button>
              {voidable && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-ink-muted"
                  disabled={stale}
                  onClick={startVoid}
                >
                  {t('actions.void')}
                </Button>
              )}
            </>
          ) : (
            <span className="text-[11.5px] leading-tight text-ink-muted">
              {t('actions.askDentist')}
            </span>
          ))}
      </span>
    </div>
  );
}

function OutstandingTable({
  search,
  locale,
  onSearch,
}: {
  search: PaymentsSearch;
  locale: string;
  onSearch: PaymentsPageProps['onSearch'];
}) {
  const { t } = useTranslation('payments');
  const openPayment = useRecordPayment();
  const pages = useCursorStack(
    JSON.stringify([search.bucket, search.q, search.group, search.size]),
  );
  const list = useQuery({
    ...outstandingQuery(outstandingQueryOf(search, pages.cursor)),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const stale = list.isPlaceholderData;
  return (
    <TableCard
      minWidth={860}
      footer={
        items.length > 0 ? (
          <Pager
            search={search}
            onSearch={onSearch}
            canBack={pages.canBack}
            nextCursor={list.data?.nextCursor}
            stale={stale}
            onBack={pages.back}
            onNext={pages.next}
          />
        ) : undefined
      }
    >
      <div role="table" aria-label={t('columns.outstanding')} aria-busy={stale}>
        <TableHead
          columns={OUTSTANDING_COLUMNS}
          labels={[
            t('columns.patient'),
            t('columns.oldestUnpaid'),
            t('columns.openVisits'),
            t('columns.bucket'),
            <span key="balance" className="block text-end">
              {t('columns.balance')}
            </span>,
            '',
          ]}
        />
        <ListBody
          isPending={list.isPending}
          error={list.isError && !list.data ? list.error : null}
          empty={items.length === 0}
          columns={OUTSTANDING_COLUMNS}
          onRetry={() => void list.refetch()}
          filtered={activeFilterCount(search) > 0}
          onClear={() => {
            onSearch(clearFilters(search));
          }}
        >
          {items.map((item: OutstandingItem) => {
            const family = search.group === 'payer' && item.payer !== null;
            return (
              <div
                key={family ? (item.payer?.contactId ?? item.patient.id) : item.patient.id}
                role="row"
                className={cn(
                  'grid min-h-14 items-center gap-2.5 border-t border-row-divider bg-surface px-3 py-1.5 text-[12.5px]',
                  stale && 'opacity-60',
                )}
                style={{ gridTemplateColumns: OUTSTANDING_COLUMNS }}
              >
                {family ? (
                  <span role="cell" className="min-w-0">
                    <span className="block truncate font-medium">
                      {t('family.name', { name: item.payer?.name ?? '' })}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      {item.members.map((member, index) => (
                        <span key={member.id}>
                          {index > 0 && ', '}
                          <Link
                            to="/patients/$patientId"
                            params={{ patientId: member.id }}
                            search={{ tab: 'balance' }}
                            className="text-ink-secondary hover:text-primary hover:underline"
                          >
                            {member.fullName}
                          </Link>
                        </span>
                      ))}
                    </span>
                  </span>
                ) : (
                  <span role="cell" className="min-w-0">
                    <Link
                      to="/patients/$patientId"
                      params={{ patientId: item.patient.id }}
                      search={{ tab: 'balance' }}
                      className="block truncate font-medium text-ink hover:text-primary hover:underline"
                    >
                      {item.patient.fullName}
                    </Link>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      <span className="font-mono">{item.patient.displayNumber}</span>
                      {item.payer && ` · ${t('family.billedTo', { name: item.payer.name })}`}
                    </span>
                  </span>
                )}
                <span role="cell" className="font-mono">
                  {formatCalendarDate(item.oldestUnpaid, locale)}
                </span>
                <span role="cell" className="font-mono">
                  {item.openVisits}
                </span>
                <span role="cell">
                  <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-border px-2 py-1 text-[11.5px] leading-none">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: BUCKET_COLOURS[item.bucket] }}
                    />
                    {t(`buckets.${item.bucket}`)}
                  </span>
                </span>
                <span
                  role="cell"
                  dir="ltr"
                  className="text-end font-mono font-semibold text-danger"
                >
                  {formatMoney({ amount: item.balance, currency: item.currency }, locale)}
                </span>
                <span role="cell" className="flex items-center justify-end gap-1">
                  {openPayment && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={stale}
                      onClick={() => {
                        openPayment(
                          family && item.payer?.contactId
                            ? {
                                patientId: item.payFor,
                                payerContactId: item.payer.contactId,
                                household: true,
                              }
                            : { patientId: item.patient.id },
                        );
                      }}
                    >
                      {t('actions.takePayment')}
                    </Button>
                  )}
                  {/* An adjustment is on one account: a family row has no single one. */}
                  {!family && (
                    <AdjustBalanceMenu
                      patientId={item.patient.id}
                      label={t('actions.more', { name: item.patient.fullName })}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </ListBody>
      </div>
    </TableCard>
  );
}
