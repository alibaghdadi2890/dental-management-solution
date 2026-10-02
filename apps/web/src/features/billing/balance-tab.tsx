import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { BalanceCard } from './balance-card';

/**
 * The record's Balance & payments tab (4b, L5): the balance with the most recent visit split
 * from the earlier ones, and the payment history — empty until payments arrive (feature 5), so
 * no Record payment button either.
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
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[1_1_320px]">
        <BalanceCard patientId={patientId} currency={currency} locale={locale} detailed />
      </div>
      <div className="min-w-0 flex-[2_1_520px]">
        <Card
          title={t('payments.title')}
          action={<span className="text-[12px] text-ink-muted">{t('payments.newestFirst')}</span>}
        >
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="m-0 mb-1 text-[13.5px] font-semibold">{t('payments.emptyTitle')}</p>
            <p className="m-0 text-[12.5px] leading-snug text-ink-muted">
              {t('payments.emptyBody')}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
