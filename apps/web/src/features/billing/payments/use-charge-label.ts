import { formatVisitNumber } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate } from '@/lib/format';

/** "V-000012 · 4 Sep 2026", "Opening balance · …", "Adjustment · …": what a charge is. */
export function useChargeLabel(): (charge: {
  kind: string;
  visitNumber: number | null;
  date: string;
}) => string {
  const { t, i18n } = useTranslation('billing');
  const locale = i18n.resolvedLanguage ?? 'en';
  return (charge) => {
    const date = formatCalendarDate(charge.date, locale);
    if (charge.visitNumber !== null) {
      return t('charge.visit', { number: formatVisitNumber(charge.visitNumber), date });
    }
    return charge.kind === 'opening_balance'
      ? t('charge.opening', { date })
      : t('charge.adjustment', { date });
  };
}
