import type { BalanceMoney } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardSkeleton } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { balanceQuery } from './billing-api';
import { owedBalances } from './owed-balances';

const NONE = '—';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12.5px] leading-none text-ink-secondary">{label}</span>
      {children}
    </div>
  );
}

const owing = (money: BalanceMoney) => Number(money.amount) > 0;

/**
 * The patient record's Overview "Balance" card (workspace spec §Tab: Overview, patients design
 * Q13), for callers with `payment:read`. Until visits exist there is no current visit, so
 * "Current visit outstanding" reads "—" and "Previous outstanding" is the whole ledger balance in
 * the tenant currency; a balance in any other currency is listed under it. Total outstanding is
 * danger-toned while anything is owed, in any currency, and success-toned when clear. No
 * "Payments →" link and no Record payment yet: payments arrive with their own feature.
 */
export function BalanceCard({
  patientId,
  currency,
  locale,
}: {
  patientId: string;
  /** The tenant currency, which the card leads with. */
  currency: string;
  locale: string;
}) {
  const { t } = useTranslation('billing');
  const balance = useQuery(balanceQuery(patientId));

  let body: ReactNode;
  if (balance.isPending) {
    body = <CardSkeleton label={t('balance.loading')} />;
  } else if (balance.isError) {
    body = (
      <p role="alert" className="text-[12.5px] leading-snug text-ink-muted">
        {t('balanceFailed')}
      </p>
    );
  } else {
    const owed = owedBalances(balance.data.balances, currency);
    const lead = owed.find((money) => money.currency === currency) ?? { amount: '0', currency };
    const others = owed.filter((money) => money.currency !== currency);
    const anyOwing = owed.some(owing);
    body = (
      <>
        <Row label={t('balance.currentVisit')}>
          <span className="font-mono text-[14px] leading-none font-semibold text-ink-muted">
            {NONE}
          </span>
        </Row>
        <Row label={t('balance.previous')}>
          <span
            className={cn(
              'font-mono text-[14px] leading-none font-semibold tabular-nums',
              owing(lead) ? 'text-danger' : 'text-ink-muted',
            )}
          >
            {formatMoney(lead, locale)}
          </span>
        </Row>
        {others.length > 0 && (
          <p className="m-0 text-end font-mono text-[11.5px] leading-snug text-ink-muted tabular-nums">
            {t('balance.otherCurrencies', {
              amounts: others.map((money) => formatMoney(money, locale)).join(' · '),
            })}
          </p>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-divider-strong pt-[11px]">
          <span className="text-[13px] leading-none font-semibold">{t('balance.total')}</span>
          <span
            className={cn(
              'font-mono text-[24px] leading-none font-bold tracking-[-0.02em] tabular-nums',
              anyOwing ? 'text-danger' : 'text-success',
            )}
          >
            {formatMoney(lead, locale)}
          </span>
        </div>
      </>
    );
  }

  return <Card title={t('balance.title')}>{body}</Card>;
}
