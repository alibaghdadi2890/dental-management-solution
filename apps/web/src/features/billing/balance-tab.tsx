import {
  type AccountAdjustment,
  formatVisitNumber,
  type PaymentHistoryItem,
  toCents,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardSkeleton } from '@/components/ui/card';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAdjustmentReasonLabel } from './adjust/reason-label';
import { BalanceCard } from './balance-card';
import { FamilyCards } from './family-card';
import { useRecordPayment } from './payments/payment-dialog-context';
import { accountQuery, openPrintable, printPath } from './payments-api';
import { useChargeLabel } from './payments/use-charge-label';

const GRID = 'grid grid-cols-[96px_84px_116px_minmax(0,1fr)_88px_64px] items-baseline gap-3';

/**
 * The record's Balance & payments tab (4b L5, feature 5 §Screens 3): the balance card (with
 * Record payment and the credit note) and the payment history, newest first, with the running
 * **Remaining** (charges dated on or before each payment, less payments up to it), "n visits" for
 * a split payment, refunds and voids, and a Receipt link per row; balance adjustments are rows of
 * their own among them (feature 7, H4). Statement prints the account.
 * Under the balance, the families the patient is in (`FamilyCards`).
 */
export function BalanceTab({
  patientId,
  currency,
  locale,
}: {
  patientId: string;
  currency: string;
  locale: string;
}) {
  const { t } = useTranslation('billing');
  const account = useQuery(accountQuery(patientId));
  const openPayment = useRecordPayment();
  const history = historyRows(account.data?.history ?? [], account.data?.adjustments ?? []);
  const owing = account.data !== undefined && toCents(account.data.balance) > 0n;

  let body;
  if (account.isPending) {
    body = <CardSkeleton label={t('payments.loading')} />;
  } else if (account.isError) {
    body = (
      <p role="alert" className="text-[12.5px] leading-snug text-ink-muted">
        {t('balanceFailed')}
      </p>
    );
  } else if (history.length === 0) {
    body = (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
        <p className="m-0 mb-1 text-[13.5px] font-semibold">{t('payments.emptyTitle')}</p>
        <p className="m-0 text-[12.5px] leading-snug text-ink-muted">{t('payments.emptyBody')}</p>
        {owing && openPayment && (
          <Button
            variant="primary"
            className="mt-3"
            onClick={() => {
              openPayment({ patientId });
            }}
          >
            {t('balance.recordFirst')}
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <div role="table" aria-label={t('payments.title')} className="overflow-x-auto">
        <div
          role="row"
          className={cn(
            GRID,
            'min-w-[560px] rounded-md bg-sunken px-2.5 py-2 text-[10px] font-medium tracking-[.06em] text-ink-muted uppercase',
          )}
        >
          <span role="columnheader">{t('payments.date')}</span>
          <span role="columnheader">{t('payments.amount')}</span>
          <span role="columnheader">{t('payments.method')}</span>
          <span role="columnheader">{t('payments.visit')}</span>
          <span role="columnheader" className="text-end">
            {t('payments.remaining')}
          </span>
          <span role="columnheader" />
        </div>
        {history.map((row) =>
          row.kind === 'payment' ? (
            <HistoryLine key={row.item.id} item={row.item} locale={locale} />
          ) : (
            <AdjustmentLine key={row.item.id} item={row.item} locale={locale} />
          ),
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        <BalanceCard patientId={patientId} currency={currency} locale={locale} detailed />
        {account.data && <FamilyCards account={account.data} locale={locale} />}
      </div>
      <div className="min-w-0 flex-[2_1_520px]">
        <Card
          title={t('payments.title')}
          action={
            <span className="flex items-center gap-3">
              <span className="text-[12px] text-ink-muted">{t('payments.newestFirst')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  openPrintable(printPath.statement(patientId));
                }}
              >
                {t('balance.statement')}
              </Button>
            </span>
          }
        >
          {body}
        </Card>
      </div>
    </div>
  );
}

type HistoryRow =
  | { kind: 'payment'; date: string; item: PaymentHistoryItem }
  | { kind: 'adjustment'; date: string; item: AccountAdjustment };

/**
 * Payments and adjustments as one list, newest first. On one day the payments come first: the
 * running Remaining counts a day's adjustments before its payments, and the list reads backwards.
 */
function historyRows(
  payments: readonly PaymentHistoryItem[],
  adjustments: readonly AccountAdjustment[],
): HistoryRow[] {
  const rows: HistoryRow[] = [
    ...payments.map((item) => ({ kind: 'payment' as const, date: item.paidAt, item })),
    ...adjustments.map((item) => ({ kind: 'adjustment' as const, date: item.date, item })),
  ];
  // Stable: each list arrives newest first, and payments were put in first.
  return rows.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/** A balance adjustment: labelled by its reason, the amount coloured by its direction. */
function AdjustmentLine({ item, locale }: { item: AccountAdjustment; locale: string }) {
  const { t } = useTranslation('billing');
  const reasonLabel = useAdjustmentReasonLabel();
  const less = toCents(item.amount) < 0n;
  const money = (amount: string) => formatMoney({ amount, currency: item.currency }, locale);
  return (
    <div
      role="row"
      className={cn(
        GRID,
        'min-w-[560px] border-b border-inner-divider px-2.5 py-2.5 text-[12.5px] last:border-b-0',
      )}
    >
      <span role="cell" className="font-mono">
        {formatCalendarDate(item.date, locale)}
      </span>
      <span
        role="cell"
        dir="ltr"
        className={cn('font-mono font-semibold', less ? 'text-success' : 'text-danger')}
      >
        {less ? `−${money(item.amount.replace('-', ''))}` : `+${money(item.amount)}`}
      </span>
      <span role="cell">{t('payments.adjustment')}</span>
      <span role="cell" className="min-w-0">
        <span className="block truncate">{reasonLabel(item.reason)}</span>
        {(item.note !== null || item.recordedBy !== null) && (
          <span className="block truncate text-[11.5px] text-ink-muted">
            {[item.note, item.recordedBy].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <span role="cell" dir="ltr" className="text-end font-mono font-medium text-ink-muted">
        {money(item.remaining)}
      </span>
      <span role="cell" />
    </div>
  );
}

function HistoryLine({ item, locale }: { item: PaymentHistoryItem; locale: string }) {
  const { t } = useTranslation('billing');
  const chargeLabel = useChargeLabel();
  const money = (amount: string) => formatMoney({ amount, currency: item.currency }, locale);
  const refund = item.kind === 'refund';
  const visits = item.allocations.filter((line) => line.visitNumber !== null);
  const [only] = visits;
  let target = '';
  if (refund) target = item.reason ?? '';
  else if (visits.length > 1) target = t('payments.visits', { count: visits.length });
  else if (only?.visitNumber != null)
    target = `${formatVisitNumber(only.visitNumber)} · ${formatCalendarDate(only.date, locale)}`;
  else if (item.allocations[0]) target = chargeLabel(item.allocations[0]);
  const notes = [
    item.reference,
    toCents(item.refunded) > 0n ? t('payments.refunded', { amount: money(item.refunded) }) : null,
    item.voided ? t('payments.voided') : null,
  ].filter(Boolean);

  return (
    <div
      role="row"
      className={cn(
        GRID,
        'min-w-[560px] border-b border-inner-divider px-2.5 py-2.5 text-[12.5px] last:border-b-0',
        item.voided && 'opacity-60',
      )}
    >
      <span role="cell" className="font-mono">
        {formatCalendarDate(item.paidAt, locale)}
      </span>
      <span
        role="cell"
        dir="ltr"
        className={cn(
          'font-mono font-semibold',
          refund ? 'text-danger' : 'text-success',
          item.voided && 'line-through',
        )}
      >
        {refund ? `−${money(item.amount)}` : money(item.amount)}
      </span>
      <span role="cell">{t(`methods.${item.method}`)}</span>
      <span role="cell" className="min-w-0">
        <span className="block truncate">{target}</span>
        {notes.length > 0 && (
          <span className="block truncate text-[11.5px] text-ink-muted">{notes.join(' · ')}</span>
        )}
      </span>
      <span role="cell" dir="ltr" className="text-end font-mono font-medium text-ink-muted">
        {money(item.remaining)}
      </span>
      <span role="cell" className="text-end">
        {!refund && (
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-primary hover:underline"
            onClick={() => {
              openPrintable(printPath.receipt(item.id));
            }}
          >
            {t('payments.receipt')}
          </button>
        )}
      </span>
    </div>
  );
}
