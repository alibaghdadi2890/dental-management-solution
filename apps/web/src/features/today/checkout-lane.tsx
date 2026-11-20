import { formatVisitNumber, type VisitBalance, type VisitListItem } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { HUE_BUTTON, useRowArrival } from '@/components/board/board-kit';
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
 * when it finished, what was done, what it still owes in large type, and **Check out** — a row of
 * the board's rose Ready for checkout card.
 */
export function CheckoutCard({
  visit,
  balance,
  selected,
  timeZone,
  locale,
  canCheckOut,
  followUpWaiting,
  onCheckout,
}: {
  visit: VisitListItem;
  balance: VisitBalance | undefined;
  /** Its checkout panel is open. */
  selected: boolean;
  timeZone: string;
  locale: string;
  /** `payment:write`; without it the card says front desk collects (F4). */
  canCheckOut: boolean;
  /** Its follow-up is still to book (A17). */
  followUpWaiting: boolean;
  onCheckout: () => void;
}) {
  const { t } = useTranslation(['today', 'clinical', 'scheduling']);
  const arrival = useRowArrival();
  const facts = [
    formatVisitNumber(visit.displayNumber),
    t(`clinical:flow.types.${visit.type}`),
    visit.dentist.name,
    visit.room?.name,
    visit.completedAt
      ? t('checkout.finished', { time: timeOf(visit.completedAt, timeZone, locale) })
      : undefined,
  ].filter(Boolean);

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-row-divider px-3.5 py-3 first:border-t-0',
        selected &&
          'bg-(--hue-tint) shadow-[inset_3px_0_0_var(--hue)] rtl:shadow-[inset_-3px_0_0_var(--hue)]',
        arrival,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] leading-tight font-semibold tracking-[-0.01em]">
            {visit.patient.fullName}
          </span>
          <span className="text-[12.5px] leading-snug text-ink-secondary">{facts.join(' · ')}</span>
        </div>
        <span className="truncate text-[13px] leading-snug text-ink-secondary">
          {visit.services.map((service) => service.name).join(', ')}
        </span>
        {followUpWaiting ? (
          <span className="text-[12.5px] leading-snug font-medium text-primary">
            {t('scheduling:followUp.toSchedule')}
          </span>
        ) : null}
      </div>
      <span
        dir="ltr"
        className="flex-none font-mono text-[22px] leading-none font-bold tracking-[-0.02em] text-(--hue-ink) tabular-nums"
      >
        {balance
          ? formatMoney({ amount: balance.outstanding, currency: visit.currency }, locale)
          : ''}
      </span>
      {canCheckOut ? (
        <Button
          variant="primary"
          className={cn(HUE_BUTTON, 'h-10 flex-none px-5 text-[13px] font-semibold')}
          aria-label={t('checkout.actionFor', { name: visit.patient.fullName })}
          onClick={onCheckout}
        >
          {t('checkout.action')}
        </Button>
      ) : (
        <span className="flex-none text-[12.5px] leading-snug font-medium text-warning">
          {t('checkout.awaitingFrontDesk')}
        </span>
      )}
    </li>
  );
}
