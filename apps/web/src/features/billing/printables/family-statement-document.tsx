import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { familyStatementQuery } from '../payments-api';
import { Parties, PrintSheet, Totals } from './print-sheet';
import { StatementLines } from './statement-document';
import { useTenantToday } from './use-tenant-today';

/**
 * A family statement (feature 5): addressed to the billing contact, one section per account of
 * their family — each with its entries, running balance and totals — and what the family owes.
 * Long families run over more than one page.
 */
export function FamilyStatementDocument({ contactId }: { contactId: string }) {
  const { t, i18n } = useTranslation('printables');
  const locale = i18n.resolvedLanguage ?? 'en';
  const statement = useQuery(familyStatementQuery(contactId));
  const today = useTenantToday();
  const data = statement.data;

  return (
    <PrintSheet
      title={t('familyStatement.title')}
      multiPage
      number={formatCalendarDate(today, locale)}
      state={statement.isError ? 'error' : data ? undefined : 'loading'}
    >
      {data && (
        <>
          <Parties
            columns={[
              { label: t('billTo'), lines: [data.payer.name] },
              {
                label: t('familyStatement.members'),
                lines: data.members.map(
                  (member) => `${member.patient.fullName} · ${member.patient.displayNumber}`,
                ),
              },
              { label: t('statement.asOf'), lines: [formatCalendarDate(today, locale)] },
            ]}
          />
          {data.members.map((member) => (
            <section key={member.patient.id} className="mb-6 break-inside-avoid">
              <h2 className="m-0 mb-1 text-[13px] font-semibold">
                {member.patient.fullName}{' '}
                <span className="font-mono text-[11.5px] font-normal text-ink-muted">
                  {member.patient.displayNumber}
                </span>
              </h2>
              <StatementLines statement={member} locale={locale} />
            </section>
          ))}
          <Totals
            lines={[
              {
                label: t('familyStatement.total'),
                amount: formatMoney({ amount: data.total, currency: data.currency }, locale),
                strong: true,
              },
            ]}
          />
        </>
      )}
    </PrintSheet>
  );
}
