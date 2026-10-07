import { formatReceiptNumber, formatVisitNumber, type Statement, toCents } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { statementQuery } from '../payments-api';
import { ItemsTable, Parties, PrintSheet, Totals } from './print-sheet';
import { useTenantToday } from './use-tenant-today';
import { useAdjustmentReasonLabel } from '../adjust/reason-label';

/**
 * A patient's account statement (B9): every entry from the opening balance on — charges, their
 * corrections, adjustments, payments and refunds (voided payments left out) — with the running
 * balance, and the totals charged, paid and outstanding.
 */
export function StatementDocument({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation('printables');
  const locale = i18n.resolvedLanguage ?? 'en';
  const statement = useQuery(statementQuery(patientId));
  const today = useTenantToday();
  const data = statement.data;

  return (
    <PrintSheet
      title={t('statement.title')}
      number={data ? `${data.patient.displayNumber} · ${formatCalendarDate(today, locale)}` : ''}
      state={statement.isError ? 'error' : data ? undefined : 'loading'}
    >
      {data && (
        <>
          <Parties
            columns={[
              { label: t('patient'), lines: [data.patient.fullName, data.patient.displayNumber] },
              { label: t('billTo'), lines: [data.billingContact?.name ?? data.patient.fullName] },
              { label: t('statement.asOf'), lines: [formatCalendarDate(today, locale)] },
            ]}
          />
          <StatementLines statement={data} locale={locale} />
        </>
      )}
    </PrintSheet>
  );
}

/** One account's entries with the running balance, and its totals (shared with the family
 * statement). */
export function StatementLines({ statement, locale }: { statement: Statement; locale: string }) {
  const { t } = useTranslation(['printables', 'billing']);
  const money = (amount: string) => formatMoney({ amount, currency: statement.currency }, locale);
  const reasonLabel = useAdjustmentReasonLabel();
  const describe = (line: Statement['lines'][number]) => {
    const parts = [t(`statement.kind.${line.kind}`)];
    if (line.visitNumber !== null) parts.push(formatVisitNumber(line.visitNumber));
    if (line.receiptNumber !== null) parts.push(formatReceiptNumber(line.receiptNumber));
    if (line.method) parts.push(t(`billing:methods.${line.method}`));
    if (line.reason) parts.push(reasonLabel(line.reason));
    if (line.note) parts.push(line.note);
    return parts.join(' · ');
  };
  return (
    <>
      <ItemsTable
        headers={[
          t('date'),
          t('statement.description'),
          t('statement.charges'),
          t('statement.payments'),
          t('statement.balance'),
        ]}
        numeric={[2, 3, 4]}
        rows={statement.lines.map((line) => {
          const owed = toCents(line.amount) > 0n;
          return [
            <span key="date" className="font-mono">
              {formatCalendarDate(line.date, locale)}
            </span>,
            describe(line),
            owed ? money(line.amount) : '',
            owed ? '' : money(line.amount.replace('-', '')),
            money(line.balance),
          ];
        })}
      />
      <Totals
        lines={[
          { label: t('statement.charged'), amount: money(statement.charged) },
          { label: t('statement.paid'), amount: money(statement.paid) },
          { label: t('statement.outstanding'), amount: money(statement.outstanding), strong: true },
        ]}
      />
    </>
  );
}
