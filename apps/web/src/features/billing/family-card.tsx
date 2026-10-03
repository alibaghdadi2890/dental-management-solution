import { type PatientAccount, toCents } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/list';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRecordPayment } from './payments/payment-dialog-context';
import { familyQuery, openPrintable, printPath } from './payments-api';

/**
 * The families this patient belongs to as a payer's household (feature 5, ADR-0028): the family
 * of each of their billing contacts, and the family they pay for themselves (a parent). Only
 * families of more than one account are shown.
 */
export function FamilyCards({ account, locale }: { account: PatientAccount; locale: string }) {
  const contactIds = [
    ...new Set(
      [account.payerFor?.contactId, ...account.payers.map((payer) => payer.contactId)].filter(
        (id): id is string => typeof id === 'string',
      ),
    ),
  ];
  return (
    <>
      {contactIds.map((contactId) => (
        <FamilyCard
          key={contactId}
          contactId={contactId}
          patientId={account.patientId}
          locale={locale}
        />
      ))}
    </>
  );
}

/**
 * One billing contact's family: each account with its balance and oldest unpaid charge, the
 * total, **Record family payment** (the household preset, `payment:write`) and **Family
 * statement**.
 */
function FamilyCard({
  contactId,
  patientId,
  locale,
}: {
  contactId: string;
  patientId: string;
  locale: string;
}) {
  const { t } = useTranslation('billing');
  const family = useQuery(familyQuery(contactId));
  const openPayment = useRecordPayment();
  const data = family.data;
  if (!data || data.members.length < 2) return null;
  const money = (amount: string) => formatMoney({ amount, currency: data.currency }, locale);
  const owing = toCents(data.total) > 0n;

  return (
    <Card
      title={t('family.title', { name: data.payer.name })}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            openPrintable(printPath.familyStatement(contactId));
          }}
        >
          {t('family.statement')}
        </Button>
      }
    >
      <ul aria-label={t('family.members', { name: data.payer.name })} className="m-0 list-none p-0">
        {data.members.map((member) => (
          <li
            key={member.id}
            className="flex items-center gap-2 border-b border-inner-divider py-2 text-[12.5px] last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              {member.id === patientId ? (
                <span className="font-medium">{member.fullName}</span>
              ) : (
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: member.id }}
                  search={{ tab: 'balance' }}
                  className="font-medium text-ink hover:text-primary hover:underline"
                >
                  {member.fullName}
                </Link>
              )}
              {member.oldestUnpaid && (
                <span className="block text-[11.5px] text-ink-muted">
                  {t('family.oldest', { date: formatCalendarDate(member.oldestUnpaid, locale) })}
                </span>
              )}
            </span>
            {member.isPayer && <Pill tone="indigo">{t('family.payer')}</Pill>}
            <span
              dir="ltr"
              className={cn(
                'font-mono font-semibold tabular-nums',
                toCents(member.balance) > 0n ? 'text-danger' : 'text-ink-muted',
              )}
            >
              {money(member.balance)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-divider-strong pt-[11px]">
        <span className="text-[13px] font-semibold">{t('family.total')}</span>
        <span
          dir="ltr"
          className={cn(
            'font-mono text-[20px] font-bold tabular-nums',
            owing ? 'text-danger' : 'text-success',
          )}
        >
          {money(data.total)}
        </span>
      </div>
      {openPayment && owing && data.payFor && (
        <Button
          variant="primary"
          size="lg"
          className="mt-3"
          onClick={() => {
            if (data.payFor) {
              openPayment({ patientId: data.payFor, payerContactId: contactId, household: true });
            }
          }}
        >
          {t('family.record')}
        </Button>
      )}
    </Card>
  );
}
