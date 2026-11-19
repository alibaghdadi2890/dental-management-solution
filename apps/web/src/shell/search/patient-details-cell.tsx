import type { Session } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PatientDetails } from './use-patient-details';

/** The end of a patient row: the next appointment, then what they owe or have in credit. */
export function PatientDetailsCell({
  details,
  tenant,
}: {
  details: PatientDetails;
  tenant: NonNullable<Session['tenant']>;
}) {
  const { t, i18n } = useTranslation('shell');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { next, balance } = details;
  if (!next && !balance) return null;
  return (
    <span className="flex flex-none flex-col items-end gap-1 text-xs leading-none">
      {next && (
        <span className="text-ink-secondary tabular-nums">
          {t('search.next', {
            when: formatDateTime(next.startsAt, { timeZone: tenant.timeZone, locale }),
          })}
        </span>
      )}
      {balance && (
        <span
          className={cn('font-medium', balance.state === 'owes' ? 'text-danger' : 'text-success')}
        >
          {balance.money
            ? t(balance.state === 'owes' ? 'search.owesAmount' : 'search.creditAmount', {
                amount: formatMoney(balance.money, locale),
              })
            : t(balance.state === 'owes' ? 'search.owes' : 'search.credit')}
        </span>
      )}
    </span>
  );
}
