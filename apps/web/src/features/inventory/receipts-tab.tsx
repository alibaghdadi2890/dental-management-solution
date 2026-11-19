import { formatGoodsReceiptNumber, type Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  Pill,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { Switch } from '@/components/ui/switch';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { receiptsQuery, suppliersQuery } from './inventory-api';
import { BranchSwitch } from './inventory-page';
import type { InventorySearch } from './inventory-search';
import { useInventoryWords } from './inventory-words';
import { PERIODS, type Period, periodSpan } from './periods';

/** Receipts (C1): number, date, supplier, invoice, lines, _To price_, the total with money. */
export function ReceiptsTab({
  session,
  branchId,
  search,
  onSearch,
}: {
  session: Session;
  branchId: string;
  search: InventorySearch;
  onSearch: (next: Partial<InventorySearch>) => void;
}) {
  const { t, locale } = useInventoryWords();
  const navigate = useNavigate();
  const canWrite = usePermission('inventory:write');
  const canMoney = usePermission('inventory:money_read');
  const canPay = usePermission('inventory:money_manage');
  const suppliers = useQuery(suppliersQuery(true));
  const receipts = useQuery(
    receiptsQuery({
      branchId,
      supplierId: search.supplier,
      from: search.from,
      to: search.to,
      toPrice: search.toPrice,
    }),
  );
  const currency = session.tenant?.currency ?? 'USD';
  const today = todayIn(session.tenant?.timeZone ?? 'UTC');
  const period =
    PERIODS.find((value) => {
      const span = periodSpan(value, today);
      return span.from === search.from && span.to === search.to;
    }) ?? '';
  const columns = canMoney
    ? '110px 110px minmax(160px,1.4fr) 140px 70px 110px 120px'
    : '110px 110px minmax(160px,1.4fr) 140px 70px 110px';
  const rows = receipts.data?.items ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <BranchSwitch
          session={session}
          branchId={branchId}
          onChange={(branch) => {
            onSearch({ branch });
          }}
        />
        <FilterChip
          label={t('filters.supplier')}
          value={search.supplier ?? ''}
          options={[
            { value: '', label: t('filters.all') },
            ...(suppliers.data ?? []).map((row) => ({ value: row.id, label: row.name })),
          ]}
          onChange={(supplier) => {
            onSearch({ supplier: supplier || undefined });
          }}
        />
        <FilterChip
          label={t('reports.period')}
          value={period}
          options={[
            { value: '', label: t('filters.all') },
            ...PERIODS.map((value) => ({ value, label: t(`period.${value}`) })),
          ]}
          onChange={(value) => {
            onSearch(
              value === ''
                ? { from: undefined, to: undefined }
                : periodSpan(value as Period, today),
            );
          }}
        />
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <Switch
            checked={search.toPrice === true}
            onCheckedChange={(on) => {
              onSearch({ toPrice: on ? true : undefined });
            }}
            label={t('receipt.toPrice')}
          />
          {t('receipt.toPrice')}
        </label>
        <div className="ms-auto flex gap-2">
          {canPay && (
            <Link
              to="/inventory/receipts/new"
              search={{ branch: branchId, oneOff: true }}
              className="inline-flex h-9 items-center rounded-lg border border-border-control px-3.5 text-[12.5px] font-medium hover:border-ink"
            >
              {t('receipt.oneOff')}
            </Link>
          )}
          {canWrite && (
            <Link
              to="/inventory/receipts/new"
              search={{ branch: branchId }}
              className="inline-flex h-9 items-center rounded-lg border border-primary bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary-hover"
            >
              {t('stock.receive')}
            </Link>
          )}
        </div>
      </div>
      <TableCard minWidth={canMoney ? 860 : 740}>
        <div role="table" aria-label={t('tabs.receipts')}>
          <TableHead
            columns={columns}
            labels={[
              t('receipts.columns.number'),
              t('receipts.columns.date'),
              t('receipts.columns.supplier'),
              t('receipts.columns.invoice'),
              t('receipts.columns.lines'),
              '',
              ...(canMoney
                ? [
                    <span key="t" className="block text-end">
                      {t('receipt.total')}
                    </span>,
                  ]
                : []),
            ]}
          />
          {receipts.isPending ? (
            <SkeletonRows columns={columns} label={t('loading')} />
          ) : receipts.isError ? (
            <ErrorState
              title={t('failed.title')}
              body={t('failed.body')}
              error={receipts.error}
              onRetry={() => void receipts.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState title={t('receipts.empty')} body="" />
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                role="row"
                className={cn(
                  'grid min-h-11 cursor-pointer items-center gap-2.5 border-t border-row-divider px-3 text-[13px] hover:bg-faint',
                  row.voided && 'text-ink-muted line-through',
                )}
                style={{ gridTemplateColumns: columns }}
                onClick={() => {
                  void navigate({
                    to: '/inventory/receipts/$receiptId',
                    params: { receiptId: row.id },
                  });
                }}
              >
                <span role="cell" className="font-mono">
                  {formatGoodsReceiptNumber(row.number)}
                </span>
                <span role="cell">{formatCalendarDate(row.receivedOn, locale)}</span>
                <span role="cell" className="truncate">
                  {row.supplierName ?? row.payee}
                </span>
                <span role="cell" className="truncate font-mono text-[12px]">
                  {row.invoiceNumber ?? '—'}
                </span>
                <span role="cell" className="tabular-nums">
                  {row.lineCount}
                </span>
                <span role="cell">
                  {row.toPrice && !row.voided && <Pill tone="warning">{t('receipt.toPrice')}</Pill>}
                  {row.voided && <Pill tone="neutral">{t('receipt.voided')}</Pill>}
                </span>
                {canMoney && (
                  <span role="cell" dir="ltr" className="text-end font-mono tabular-nums">
                    {row.total === null
                      ? '—'
                      : formatMoney({ amount: row.total, currency }, locale)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </TableCard>
    </>
  );
}
