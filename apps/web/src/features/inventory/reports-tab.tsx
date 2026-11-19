import type { Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { InfoMark } from '@/components/ui/info-mark';
import { ErrorState, FilterChip, SkeletonRows } from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatCount, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { categoriesQuery, type MovementFilter, movementsQuery, reportQuery } from './inventory-api';
import type { InventorySearch } from './inventory-search';
import { useInventoryWords } from './inventory-words';
import { PERIODS, type Period, periodSpan } from './periods';
import { UnpricedNote } from './stock-tab';

/**
 * Reports (Part E), for a period and a branch: consumption by item and by category, adjustments
 * and write-offs by reason, purchases by supplier and stock value by category (the last two with
 * inventory money). Every number opens the movements behind it.
 */
export function ReportsTab({
  session,
  search,
  onSearch,
}: {
  session: Session;
  search: InventorySearch;
  onSearch: (next: Partial<InventorySearch>) => void;
}) {
  const { t, locale, quantity, categoryName } = useInventoryWords();
  const canMoney = usePermission('inventory:money_read');
  const [drill, setDrill] = useState<{ title: string; filter: MovementFilter }>();
  const tenant = session.tenant;
  const today = todayIn(tenant?.timeZone ?? 'UTC');
  const span =
    search.from && search.to
      ? { from: search.from, to: search.to }
      : periodSpan('this_month', today);
  const branchId = search.branch;
  const report = useQuery(reportQuery({ ...span, branchId }));
  const categories = useQuery(categoriesQuery());
  if (!tenant) return null;
  const money = (amount: string | null) =>
    amount === null ? '' : formatMoney({ amount, currency: tenant.currency }, locale);
  const byCategory = new Map((categories.data ?? []).map((row) => [row.id, row] as const));
  const base = { ...span, branchId };
  const open = (title: string, filter: MovementFilter) => {
    setDrill({ title, filter: { ...base, ...filter } });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip
          label={t('reports.period')}
          value={
            PERIODS.find((period) => {
              const other = periodSpan(period, today);
              return other.from === span.from && other.to === span.to;
            }) ?? ''
          }
          options={PERIODS.map((period) => ({ value: period, label: t(`period.${period}`) }))}
          onChange={(value) => {
            onSearch(periodSpan(value as Period, today));
          }}
        />
        {session.branches.length > 1 && (
          <FilterChip
            label={t('branch')}
            value={branchId ?? ''}
            options={[
              { value: '', label: t('reports.allBranches') },
              ...session.branches.map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
            onChange={(branch) => {
              onSearch({ branch: branch || undefined });
            }}
          />
        )}
        {report.data && <UnpricedNote unpriced={report.data.unpriced} />}
      </div>
      {report.isPending ? (
        <SkeletonRows columns="1fr 1fr 1fr" label={t('loading')} />
      ) : report.isError ? (
        <ErrorState
          title={t('failed.title')}
          body={t('failed.body')}
          error={report.error}
          onRetry={() => void report.refetch()}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-4 text-[13px]">
          <ReportCard
            title={t('reports.consumptionByItem')}
            info={t('info.consumption')}
            total={canMoney ? money(report.data.consumption.total) : undefined}
          >
            {report.data.consumption.items.map((row) => (
              <Row
                key={row.itemId}
                label={row.name}
                quantity={quantity(row.quantity, row)}
                amount={canMoney ? `${money(row.cost)}${row.unpriced ? ' *' : ''}` : undefined}
                onOpen={() => {
                  open(row.name, { itemId: row.itemId, kinds: ['take_out', 'reversal'] });
                }}
              />
            ))}
          </ReportCard>
          <ReportCard title={t('reports.consumptionByCategory')} info={t('info.consumption')}>
            {report.data.consumption.categories.map((row) => (
              <Row
                key={row.categoryId}
                label={categoryName(byCategory.get(row.categoryId))}
                quantity={formatCount(row.quantity, locale)}
                amount={canMoney ? money(row.cost) : undefined}
                onOpen={() => {
                  open(categoryName(byCategory.get(row.categoryId)), {
                    categoryId: row.categoryId,
                    kinds: ['take_out', 'reversal'],
                  });
                }}
              />
            ))}
          </ReportCard>
          <ReportCard title={t('reports.adjustments')} info={t('info.adjustments')}>
            {report.data.adjustments.map((row) => (
              <Row
                key={row.reason}
                label={t(`reason.${row.reason}`)}
                quantity={formatCount(row.quantity, locale)}
                amount={canMoney ? money(row.cost) : undefined}
                onOpen={() => {
                  open(t(`reason.${row.reason}`), {
                    kinds: ['adjust', 'count'],
                    reason: row.reason,
                  });
                }}
              />
            ))}
          </ReportCard>
          {report.data.purchases && (
            <ReportCard title={t('reports.purchases')} info={t('info.purchases')}>
              {report.data.purchases.map((row) => (
                <Row
                  key={row.supplierId ?? `payee:${row.name}`}
                  label={row.supplierId ? row.name : `${row.name} · ${t('receipt.oneOff')}`}
                  quantity={t('reports.receipts', { count: row.receipts })}
                  amount={money(row.total)}
                  {...(row.supplierId
                    ? {
                        onOpen: () => {
                          open(row.name, {
                            supplierId: row.supplierId ?? undefined,
                            kinds: ['receive'],
                          });
                        },
                      }
                    : {})}
                />
              ))}
            </ReportCard>
          )}
          {report.data.value && (
            <ReportCard
              title={t('reports.value')}
              info={t('info.value')}
              total={money(report.data.value.total)}
            >
              {report.data.value.categories.map((row) => (
                <Row
                  key={row.categoryId}
                  label={categoryName(byCategory.get(row.categoryId))}
                  amount={money(row.value)}
                  onOpen={() => {
                    onSearch({
                      tab: undefined,
                      category: row.categoryId,
                      from: undefined,
                      to: undefined,
                    });
                  }}
                />
              ))}
            </ReportCard>
          )}
        </div>
      )}
      {drill && (
        <MovementsPanel
          title={drill.title}
          filter={drill.filter}
          currency={tenant.currency}
          onClose={() => {
            setDrill(undefined);
          }}
        />
      )}
    </>
  );
}

function ReportCard({
  title,
  info,
  total,
  children,
}: {
  title: string;
  info: string;
  total?: string | undefined;
  children: ReactNode[];
}) {
  const { t } = useInventoryWords();
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex items-center gap-1.5 border-b border-border bg-faint px-4 py-2.5">
        <h2 className="m-0 text-[12.5px] font-semibold">{title}</h2>
        <InfoMark about={title}>{info}</InfoMark>
        {total && (
          <span dir="ltr" className="ms-auto font-mono font-semibold tabular-nums">
            {total}
          </span>
        )}
      </header>
      {children.length === 0 ? (
        <p className="m-0 px-4 py-4 text-ink-muted">{t('reports.nothing')}</p>
      ) : (
        <ul className="m-0 list-none p-0">{children}</ul>
      )}
    </section>
  );
}

function Row({
  label,
  quantity,
  amount,
  onOpen,
}: {
  label: string;
  quantity?: string;
  amount?: string | undefined;
  onOpen?: () => void;
}) {
  return (
    <li className="border-t border-row-divider first:border-t-0">
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2 text-start',
          onOpen && 'cursor-pointer hover:bg-faint',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {quantity && <span className="font-mono text-ink-secondary tabular-nums">{quantity}</span>}
        {amount !== undefined && (
          <span dir="ltr" className="w-28 text-end font-mono tabular-nums">
            {amount}
          </span>
        )}
      </button>
    </li>
  );
}

/** The movements behind a figure (E): who, when, what, why, and what it cost. */
export function MovementsPanel({
  title,
  filter,
  currency,
  onClose,
}: {
  title: string;
  filter: MovementFilter;
  currency: string;
  onClose: () => void;
}) {
  const { t, locale, quantity } = useInventoryWords();
  const movements = useQuery(movementsQuery(filter));
  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('reports.movements')}
        title={title}
        dirty={false}
        onClose={onClose}
        className="fixed inset-y-0 end-0 z-40 w-[560px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
      >
        <ul className="m-0 list-none divide-y divide-row-divider p-0 text-[13px]">
          {(movements.data?.items ?? []).map((movement) => (
            <li key={movement.id} className={cn('py-2', movement.reversedAt && 'text-ink-muted')}>
              <div className="flex gap-2">
                <span className="flex-1 truncate font-medium">{movement.itemName}</span>
                <span className="font-mono tabular-nums">
                  {movement.quantity > 0 ? '+' : '−'}
                  {quantity(Math.abs(movement.quantity), movement)}
                </span>
                {movement.cost !== null && (
                  <span dir="ltr" className="w-24 text-end font-mono tabular-nums">
                    {formatMoney({ amount: movement.cost, currency }, locale)}
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-ink-muted">
                {[
                  formatCalendarDate(movement.occurredOn, locale),
                  t(`movement.${movement.kind}`),
                  movement.reason ? t(`reason.${movement.reason}`) : null,
                  movement.createdByName,
                  movement.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      </RightPanel>
    </>
  );
}
