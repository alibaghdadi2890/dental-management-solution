import {
  formatInvoiceNumber,
  formatReceiptNumber,
  formatVisitNumber,
  toCents,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { visitQuery } from '@/features/clinical/visits-api';
import { contactsQuery } from '@/features/patients/contacts-api';
import { patientQuery } from '@/features/patients/patients-api';
import { useStaffNames } from '@/features/users/use-staff-names';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { visitSummaryQuery } from '../billing-api';
import { ItemsTable, Parties, PrintSheet, Totals } from './print-sheet';

/**
 * A visit's invoice (B9: `INV-` + the visit number): the services as performed (code, service,
 * tooth, amount), the discount and total, the payments that cover it and what is still due.
 * Addressed to the patient and the primary billing contact. A voided visit is marked VOID.
 */
export function InvoiceDocument({ visitId }: { visitId: string }) {
  const { t, i18n } = useTranslation(['printables', 'billing']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toothLabel = useToothLabel();
  const { dentistNames } = useStaffNames();
  const visit = useQuery(visitQuery(visitId));
  const summary = useQuery(visitSummaryQuery(visitId));
  const patientId = visit.data?.patientId ?? '';
  const patient = useQuery({ ...patientQuery(patientId), enabled: patientId !== '' });
  const contacts = useQuery({ ...contactsQuery(patientId), enabled: patientId !== '' });
  const billTo = contacts.data?.find((link) => link.isBillingContact && link.isPrimaryBilling);
  const ready = visit.data && summary.data && patient.data;
  const failed = visit.isError || summary.isError || patient.isError;
  const money = (amount: string) =>
    formatMoney({ amount, currency: visit.data?.currency ?? 'USD' }, locale);

  return (
    <PrintSheet
      title={t('invoice.title')}
      number={visit.data ? formatInvoiceNumber(visit.data.displayNumber) : ''}
      state={failed ? 'error' : ready ? undefined : 'loading'}
      watermark={visit.data?.status === 'voided' ? t('void') : undefined}
    >
      {visit.data && summary.data && patient.data && (
        <>
          <Parties
            columns={[
              {
                label: t('patient'),
                lines: [patient.data.fullName, patient.data.displayNumber, patient.data.address],
              },
              {
                label: t('invoice.visit'),
                lines: [
                  formatVisitNumber(visit.data.displayNumber),
                  formatCalendarDate(visit.data.localDate, locale),
                  dentistNames.get(visit.data.dentistId),
                ],
              },
              {
                label: billTo ? t('billTo') : t('insurance'),
                lines: billTo
                  ? [billTo.contact.fullName, billTo.contact.phone]
                  : [patient.data.insurance ?? '—'],
              },
            ]}
          />
          <ItemsTable
            headers={[t('code'), t('service'), t('tooth'), t('amount')]}
            numeric={[3]}
            rows={visit.data.services.map((service) => [
              <span key="code" className="font-mono">
                {service.code}
              </span>,
              service.name,
              service.toothCode ? toothLabel(service.toothCode) : '—',
              formatMoney(service.final, locale),
            ])}
          />
          <Totals
            lines={[
              { label: t('subtotal'), amount: money(visit.data.money.subtotal) },
              ...(toCents(visit.data.money.discount) > 0n
                ? [{ label: t('discount'), amount: `−${money(visit.data.money.discount)}` }]
                : []),
              { label: t('total'), amount: money(summary.data.visit.total), strong: true },
              { label: t('invoice.paid'), amount: money(summary.data.visit.paid) },
              { label: t('invoice.due'), amount: money(summary.data.visit.outstanding) },
            ]}
          />
          {summary.data.payments.length > 0 && (
            <section className="mt-6">
              <p className="m-0 mb-1 text-[10px] font-medium tracking-[.08em] text-ink-muted uppercase">
                {t('invoice.payments')}
              </p>
              {summary.data.payments.map((payment) => (
                <p key={payment.paymentId} className="m-0 text-[11.5px] text-ink-secondary">
                  {[
                    formatCalendarDate(payment.paidAt, locale),
                    formatReceiptNumber(payment.receiptNumber),
                    t(`billing:methods.${payment.method}`),
                    money(payment.amount),
                  ].join(' · ')}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </PrintSheet>
  );
}
