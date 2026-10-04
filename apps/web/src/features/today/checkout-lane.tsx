import { formatVisitNumber, type VisitBalance, type VisitListItem } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/** `12:40` in the tenant's time zone: when the visit finished. */
function timeOf(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

/**
 * One visit waiting for checkout (Today board, T3): who, the visit's number, dentist and room,
 * when it finished, what was done, what it still owes in large type, and **Check out**. A card of
 * its own in the header pill's amber: money waiting, not clinical work (which is the primary blue).
 */
export function CheckoutCard({
  visit,
  balance,
  selected,
  timeZone,
  locale,
  onCheckout,
}: {
  visit: VisitListItem;
  balance: VisitBalance | undefined;
  /** Its checkout panel is open. */
  selected: boolean;
  timeZone: string;
  locale: string;
  onCheckout: () => void;
}) {
  const { t } = useTranslation('today');
  const facts = [
    formatVisitNumber(visit.displayNumber),
    visit.dentist.name,
    visit.room?.name,
    visit.completedAt
      ? t('checkout.finished', { time: timeOf(visit.completedAt, timeZone, locale) })
      : undefined,
  ].filter(Boolean);

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-3.5 rounded-xl border border-warning-border bg-warning-bg px-[22px] py-[18px]',
        selected && 'border-warning shadow-[0_0_0_1px_var(--color-warning)]',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[18px] leading-tight font-semibold tracking-[-0.01em]">
            {visit.patient.fullName}
          </span>
          <span className="text-[12.5px] leading-snug text-ink-secondary">{facts.join(' · ')}</span>
        </div>
        <span className="truncate text-[13px] leading-snug text-ink-secondary">
          {visit.services.map((service) => service.name).join(', ')}
        </span>
      </div>
      <span
        dir="ltr"
        className="flex-none font-mono text-[26px] leading-none font-bold tracking-[-0.02em] text-ink tabular-nums"
      >
        {balance
          ? formatMoney({ amount: balance.outstanding, currency: visit.currency }, locale)
          : ''}
      </span>
      <Button
        variant="dark"
        className="h-11 flex-none px-[22px] text-[13.5px] font-semibold"
        aria-label={t('checkout.actionFor', { name: visit.patient.fullName })}
        onClick={onCheckout}
      >
        {t('checkout.action')}
      </Button>
    </li>
  );
}
