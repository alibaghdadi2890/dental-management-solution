import { type BalanceMoney, fromCents, toCents } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardSkeleton } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-permission';
import { lastVisitQuery } from '@/features/clinical/visits-api';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AdjustBalanceButton, AdjustBalanceMenu } from './adjust/adjust-entry';
import { balanceQuery, visitSummaryQuery } from './billing-api';
import { owedBalances } from './owed-balances';
import { accountQuery } from './payments-api';
import { useRecordPayment } from './payments/payment-dialog-context';
import { ApiError } from '@/lib/api';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12.5px] leading-none text-ink-secondary">{label}</span>
      {children}
    </div>
  );
}

const owing = (money: BalanceMoney) => Number(money.amount) > 0;

const amountClass = 'font-mono text-[14px] leading-none font-semibold tabular-nums';

/**
 * The patient's balance (workspace spec §Tab: Overview, §Tab: Balance & payments), for callers
 * with `payment:read`. With a counted visit (4b, D18) it splits the most recent visit's
 * outstanding from the earlier visits' (`GET /billing/visits/:id/summary`, in the visit's
 * currency); `detailed` (the Balance & payments tab) also shows that visit's date, total and
 * paid. Without one, "Nothing billed yet" over the ledger balance (an opening balance), led by the
 * tenant currency (or, when nothing is owed in it, by the first currency that is); any other
 * currency is listed under it. Total outstanding is danger-toned while anything is owed and
 * success-toned when clear, and a credit (a negative total) gets its note. With `payment:write`,
 * Record payment while anything is owed (feature 5). Adjust balance (feature 7, H4) is a
 * secondary button on the detailed card and a ⋯ menu on the compact one. Without `visit:read`
 * there is no split, only the ledger balance. Money paid in advance for the treatment plan
 * (ADR-0051) has its own row and stays out of the total: it pays plan work only.
 */
export function BalanceCard({
  patientId,
  currency,
  locale,
  detailed = false,
}: {
  patientId: string;
  /** The tenant currency, which the card leads with. */
  currency: string;
  locale: string;
  detailed?: boolean;
}) {
  const { t } = useTranslation('billing');
  const openPayment = useRecordPayment();
  // The visit split needs `visit:read` too; without it the card shows the ledger balance alone.
  const canVisits = usePermission('visit:read');
  const balance = useQuery(balanceQuery(patientId));
  const lastVisit = useQuery({ ...lastVisitQuery(patientId), enabled: canVisits });
  const visitId = lastVisit.data?.id;
  const summary = useQuery({
    ...visitSummaryQuery(visitId ?? ''),
    enabled: visitId !== undefined,
  });
  // The patient's last visit may be outside the caller's visit scope (ADR-0055): its summary is
  // then not found, and the card shows the account alone.
  const outOfScope = summary.error instanceof ApiError && summary.error.status === 404;
  // What is held for the plan: the visit summary carries it; without a visit, the account does.
  const noVisit = !canVisits || (lastVisit.isSuccess && visitId === undefined) || outOfScope;
  const account = useQuery({ ...accountQuery(patientId), enabled: noVisit });

  let body: ReactNode;
  if (balance.isPending || lastVisit.isLoading || summary.isLoading || account.isLoading) {
    body = <CardSkeleton label={t('balance.loading')} />;
  } else if (
    balance.isError ||
    account.isError ||
    lastVisit.isError ||
    (summary.isError && !outOfScope)
  ) {
    body = (
      <p role="alert" className="text-[12.5px] leading-snug text-ink-muted">
        {t('balanceFailed')}
      </p>
    );
  } else {
    const owed = owedBalances(balance.data.balances, currency);
    const [lead = { amount: '0', currency }, ...others] = owed;
    const anyOwing = owed.some(owing);
    const figures = summary.data?.handedOff === false ? summary.data : undefined;
    const money = (amount: string) =>
      formatMoney({ amount, currency: figures?.currency ?? currency }, locale);
    const held = toCents(figures?.held ?? account.data?.held ?? '0');
    const heldCurrency = figures?.currency ?? account.data?.currency ?? currency;
    // The summary already leaves the held money out; the ledger balance does not.
    const total = figures
      ? { amount: figures.totalOutstanding, currency: figures.currency }
      : lead.currency === heldCurrency
        ? { ...lead, amount: fromCents(toCents(lead.amount) + held) }
        : lead;
    body = (
      <>
        {figures && lastVisit.data ? (
          <>
            {detailed && (
              <>
                <p className="m-0 mb-1 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase">
                  {t('balance.recentVisit', {
                    date: formatCalendarDate(lastVisit.data.date, locale),
                  })}
                </p>
                <Row label={t('balance.visitTotal')}>
                  <span className={amountClass}>{money(figures.visit.total)}</span>
                </Row>
                <Row label={t('balance.visitPaid')}>
                  <span className={cn(amountClass, 'text-success')}>
                    {money(figures.visit.paid)}
                  </span>
                </Row>
              </>
            )}
            <Row label={t('balance.currentVisit')}>
              <span
                className={cn(
                  amountClass,
                  Number(figures.visit.outstanding) > 0 ? 'text-danger' : 'text-ink-muted',
                )}
              >
                {money(figures.visit.outstanding)}
              </span>
            </Row>
            <Row label={t('balance.previous')}>
              <span
                className={cn(
                  amountClass,
                  Number(figures.previous) > 0 ? 'text-danger' : 'text-ink-muted',
                )}
              >
                {money(figures.previous)}
              </span>
            </Row>
          </>
        ) : (
          <>
            <p className="m-0 mb-1 text-[12.5px] leading-snug text-ink-muted">
              {t('balance.nothingBilled')}
            </p>
            <Row label={t('balance.previous')}>
              <span className={cn(amountClass, owing(lead) ? 'text-danger' : 'text-ink-muted')}>
                {formatMoney(lead, locale)}
              </span>
            </Row>
          </>
        )}
        {others.length > 0 && (
          <p className="m-0 text-end font-mono text-[11.5px] leading-snug text-ink-muted tabular-nums">
            {t('balance.otherCurrencies', {
              amounts: others.map((other) => formatMoney(other, locale)).join(' · '),
            })}
          </p>
        )}
        {held > 0n && (
          <Row label={t('balance.held')}>
            <span className={cn(amountClass, 'text-success')}>
              {formatMoney({ amount: fromCents(held), currency: heldCurrency }, locale)}
            </span>
          </Row>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-divider-strong pt-[11px]">
          <span className="text-[13px] leading-none font-semibold">{t('balance.total')}</span>
          <span
            className={cn(
              'font-mono text-[24px] leading-none font-bold tracking-[-0.02em] tabular-nums',
              anyOwing || Number(total.amount) > 0 ? 'text-danger' : 'text-success',
            )}
          >
            {formatMoney(total, locale)}
          </span>
        </div>
        {Number(total.amount) < 0 && (
          <p className="m-0 mt-2.5 rounded-lg border border-success-border bg-success-bg px-3 py-2 text-[12.5px] leading-snug text-success">
            {t('balance.credit', {
              amount: formatMoney({ ...total, amount: total.amount.replace('-', '') }, locale),
            })}
          </p>
        )}
        {detailed && !anyOwing && Number(total.amount) === 0 && held === 0n && (
          <p className="m-0 mt-2.5 text-[12.5px] leading-snug text-ink-muted">
            {t('balance.settled')}
          </p>
        )}
        {openPayment && (anyOwing || Number(total.amount) > 0) && (
          <Button
            variant="primary"
            size="lg"
            className="mt-3"
            onClick={() => {
              openPayment({ patientId });
            }}
          >
            {t('balance.record')}
          </Button>
        )}
        {openPayment && !anyOwing && Number(total.amount) <= 0 && (
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              openPayment({ patientId, advance: true });
            }}
          >
            {t('record.advance.start')}
          </Button>
        )}
        {detailed && <AdjustBalanceButton patientId={patientId} className="mt-2" />}
      </>
    );
  }

  return (
    <Card
      title={t('balance.title')}
      // The tab's card has the button; the Overview's compact one keeps the action in a menu.
      action={
        detailed ? undefined : <AdjustBalanceMenu patientId={patientId} label={t('adjust.menu')} />
      }
    >
      {body}
    </Card>
  );
}
