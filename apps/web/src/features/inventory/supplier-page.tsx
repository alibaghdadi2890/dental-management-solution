import { formatGoodsReceiptNumber, type Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { FigureTile } from '@/components/ui/figure-tile';
import { InfoMark } from '@/components/ui/info-mark';
import { EmptyState, ErrorState, FilterChip, Pill, ViewTabs } from '@/components/ui/list';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  accountsQuery,
  downloadStatement,
  invalidateInventory,
  receiptsQuery,
  statementQuery,
  supplierQuery,
  voidSupplierPayment,
} from './inventory-api';
import { useInventoryWords } from './inventory-words';
import { PERIODS, type Period, periodSpan } from './periods';
import { SupplierFormPanel, type SupplierMoneyKind, SupplierMoneyPanel } from './supplier-panels';

export interface SupplierSearch {
  tab?: 'statement' | 'receipts' | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * A supplier's page (Part D, like a lab's): its figures and statement (opening balance,
 * receipts, payments, adjustments, a running balance) for whoever sees inventory money, its
 * receipts, and its details. Payments, adjustments and the opening balance are right panels.
 */
export function SupplierPage({
  session,
  supplierId,
  search,
  onSearch,
}: {
  session: Session;
  supplierId: string;
  search: SupplierSearch;
  onSearch: (next: SupplierSearch) => void;
}) {
  const { t, locale } = useInventoryWords();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const canMoney = usePermission('inventory:money_read');
  const canPay = usePermission('inventory:money_manage');
  const canManage = usePermission('inventory:manage');
  const [panel, setPanel] = useState<SupplierMoneyKind | 'edit'>();
  const tenant = session.tenant;
  const today = todayIn(tenant?.timeZone ?? 'UTC');
  const range =
    search.from && search.to
      ? { from: search.from, to: search.to }
      : periodSpan('this_month', today);
  const supplier = useQuery(supplierQuery(supplierId));
  const accounts = useQuery(accountsQuery(canMoney));
  const statement = useQuery(statementQuery(supplierId, range.from, range.to, canMoney));
  const receipts = useQuery(receiptsQuery({ supplierId }));
  if (!tenant) return null;
  if (supplier.isError) {
    return (
      <Page title={t('tabs.suppliers')}>
        <ErrorState
          title={t('failed.title')}
          body={t('failed.body')}
          error={supplier.error}
          onRetry={() => void supplier.refetch()}
        />
      </Page>
    );
  }
  const data = supplier.data;
  if (!data) return <Page title={t('loading')} />;
  const account = accounts.data?.suppliers.find((row) => row.supplierId === supplierId);
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const tab = canMoney ? (search.tab ?? 'statement') : 'receipts';

  return (
    <Page
      title={data.name}
      actions={
        <>
          <Link
            to="/inventory"
            search={{ tab: 'suppliers' }}
            className="inline-flex h-9 items-center rounded-lg border border-border-control px-3.5 text-[12.5px] font-medium hover:border-ink print:hidden"
          >
            {t('back')}
          </Link>
          {canManage && (
            <Button
              className="print:hidden"
              onClick={() => {
                setPanel('edit');
              }}
            >
              {t('suppliers.edit')}
            </Button>
          )}
          {canPay && (
            <Button
              variant="primary"
              className="print:hidden"
              onClick={() => {
                setPanel('payment');
              }}
            >
              {t('money.payment.title')}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-[1fr_280px] gap-5 max-lg:grid-cols-1">
        <div className="min-w-0">
          {canMoney && account && (
            <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              <FigureTile
                label={t('suppliers.columns.outstanding')}
                info={t('info.outstanding')}
                value={money(account.outstanding)}
                now
              />
              <FigureTile label={t('suppliers.owed')} value={money(account.owed)} now />
              <FigureTile label={t('suppliers.paid')} value={money(account.paid)} now />
              <FigureTile label={t('receipt.toPrice')} value={String(account.toPrice)} now />
            </div>
          )}
          <ViewTabs
            label={data.name}
            tabs={[
              ...(canMoney ? [{ key: 'statement' as const, label: t('suppliers.statement') }] : []),
              { key: 'receipts' as const, label: t('tabs.receipts') },
            ]}
            active={tab}
            onChange={(key) => {
              onSearch({ ...search, tab: key });
            }}
          />
          {tab === 'statement' && canMoney && (
            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
                <FilterChip
                  label={t('reports.period')}
                  value={
                    PERIODS.find((period) => {
                      const span = periodSpan(period, today);
                      return span.from === range.from && span.to === range.to;
                    }) ?? ''
                  }
                  options={PERIODS.map((period) => ({
                    value: period,
                    label: t(`period.${period}`),
                  }))}
                  onChange={(value) => {
                    const span = periodSpan(value as Period, today);
                    onSearch({ ...search, ...span });
                  }}
                />
                {canPay && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        setPanel('adjustment');
                      }}
                    >
                      {t('money.adjustment.title')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setPanel('opening');
                      }}
                    >
                      {t('money.opening.title')}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  className="ms-auto"
                  onClick={() => void downloadStatement(supplierId, range.from, range.to)}
                >
                  {t('stock.export')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    window.print();
                  }}
                >
                  {t('print')}
                </Button>
              </div>
              {statement.data ? (
                <div className="overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
                  <div className="flex justify-between border-b border-border bg-faint px-4 py-2.5">
                    <span>
                      {t('suppliers.balanceBefore', {
                        date: formatCalendarDate(range.from, locale),
                      })}
                    </span>
                    <span dir="ltr" className="font-mono">
                      {money(statement.data.balanceBefore)}
                    </span>
                  </div>
                  {statement.data.lines.length === 0 ? (
                    <p className="m-0 px-4 py-4 text-ink-muted">{t('suppliers.noLines')}</p>
                  ) : (
                    <ul className="m-0 list-none p-0">
                      {statement.data.lines.map((line) => (
                        <li
                          key={`${line.kind}:${line.sourceId}`}
                          className={cn(
                            'grid grid-cols-[100px_1fr_120px_120px_auto] items-center gap-3 border-t border-row-divider px-4 py-2 first:border-t-0',
                            line.voided && 'text-ink-muted',
                          )}
                        >
                          <span>{formatCalendarDate(line.date, locale)}</span>
                          <span className="min-w-0 truncate">
                            {t(`statement.${line.kind}`)}
                            {line.receiptNumber !== null &&
                              ` · ${formatGoodsReceiptNumber(line.receiptNumber)}`}
                            {line.description && (
                              <span className="ms-2 text-ink-muted">{line.description}</span>
                            )}
                            {line.voided && (
                              <span className="ms-2">
                                ({t('receipt.voided')}
                                {line.voidReason ? `: ${line.voidReason}` : ''})
                              </span>
                            )}
                          </span>
                          <span
                            dir="ltr"
                            className={cn(
                              'text-end font-mono tabular-nums',
                              line.voided && 'line-through',
                            )}
                          >
                            {money(line.amount)}
                          </span>
                          <span dir="ltr" className="text-end font-mono tabular-nums">
                            {money(line.balance)}
                          </span>
                          <span className="print:hidden">
                            {line.kind === 'payment' && !line.voided && canPay && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  confirm({
                                    title: t('suppliers.voidTitle'),
                                    body: t('suppliers.voidBody'),
                                    okLabel: t('receipt.void'),
                                    reasonLabel: t('history.reason'),
                                    tone: 'danger',
                                    onConfirm: async (reason) => {
                                      await voidSupplierPayment(line.sourceId, reason);
                                      await invalidateInventory(queryClient);
                                    },
                                  });
                                }}
                              >
                                {t('receipt.void')}
                              </Button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex justify-between border-t border-border bg-faint px-4 py-2.5 font-semibold">
                    <span>{t('suppliers.balanceAfter')}</span>
                    <span dir="ltr" className="font-mono">
                      {money(statement.data.balanceAfter)}
                    </span>
                  </div>
                  {statement.data.toPrice.length > 0 && (
                    <div className="border-t border-border px-4 py-2.5">
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                        {t('receipt.toPrice')}
                        <InfoMark about={t('receipt.toPrice')}>{t('info.toPrice')}</InfoMark>
                      </span>
                      <ul className="m-0 mt-1 list-none p-0">
                        {statement.data.toPrice.map((row) => (
                          <li key={row.id}>
                            <Link
                              to="/inventory/receipts/$receiptId"
                              params={{ receiptId: row.id }}
                              className="text-primary hover:underline"
                            >
                              {formatGoodsReceiptNumber(row.number)}
                            </Link>
                            <span className="ms-2 text-ink-muted">
                              {formatCalendarDate(row.receivedOn, locale)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-ink-muted">{t('loading')}</p>
              )}
            </section>
          )}
          {tab === 'receipts' && (
            <section className="overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
              {(receipts.data?.items ?? []).length === 0 ? (
                <EmptyState title={t('receipts.empty')} body="" />
              ) : (
                <ul className="m-0 list-none p-0">
                  {(receipts.data?.items ?? []).map((row) => (
                    <li
                      key={row.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 border-t border-row-divider px-4 py-2.5 first:border-t-0 hover:bg-faint',
                        row.voided && 'text-ink-muted line-through',
                      )}
                      onClick={() => {
                        void navigate({
                          to: '/inventory/receipts/$receiptId',
                          params: { receiptId: row.id },
                        });
                      }}
                    >
                      <span className="font-mono">{formatGoodsReceiptNumber(row.number)}</span>
                      <span>{formatCalendarDate(row.receivedOn, locale)}</span>
                      <span className="flex-1 truncate font-mono text-[12px]">
                        {row.invoiceNumber}
                      </span>
                      {row.toPrice && !row.voided && (
                        <Pill tone="warning">{t('receipt.toPrice')}</Pill>
                      )}
                      {canMoney && row.total !== null && (
                        <span dir="ltr" className="font-mono">
                          {money(row.total)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
        <aside className="h-fit rounded-xl border border-border bg-surface p-4 text-[13px] print:hidden">
          <h2 className="m-0 mb-2 text-[12px] font-semibold">{t('suppliers.details')}</h2>
          <dl className="m-0 flex flex-col gap-1.5">
            {[data.contactPerson, data.phone, data.email, data.address, data.note]
              .filter(Boolean)
              .map((value) => (
                <dd key={value} className="m-0 break-words">
                  {value}
                </dd>
              ))}
            {!data.active && <Pill tone="neutral">{t('suppliers.inactive')}</Pill>}
          </dl>
        </aside>
      </div>
      {panel === 'edit' && (
        <SupplierFormPanel
          supplier={data}
          onClose={() => {
            setPanel(undefined);
          }}
        />
      )}
      {panel && panel !== 'edit' && (
        <SupplierMoneyPanel
          kind={panel}
          supplier={data}
          outstanding={account?.outstanding}
          tenant={tenant}
          onClose={() => {
            setPanel(undefined);
          }}
        />
      )}
    </Page>
  );
}
