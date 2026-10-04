import { Link, useMatches } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useCheckoutQueue } from './checkout-queue';

/**
 * The header's checkout pill (checkout handoff, C8; Today board, T7): how many of today's visits
 * wait for checkout, on every screen but the Today board, which it links to. Nothing without
 * `payment:write` and `visit:read`, or with an empty queue.
 */
export function CheckoutPill() {
  const { t } = useTranslation('shell');
  const queue = useCheckoutQueue();
  const onToday = useMatches({
    select: (matches) => matches.some((match) => match.staticData.navKey === 'today'),
  });

  if (!queue.enabled || queue.visits.length === 0 || onToday) return null;
  return (
    <Link
      to="/today"
      className="flex h-8 flex-none items-center rounded-[7px] border border-warning-border bg-warning-bg px-3 text-[12.5px] leading-none font-medium whitespace-nowrap text-warning hover:border-warning"
    >
      {t('checkoutPill.label', { n: queue.visits.length })}
    </Link>
  );
}
