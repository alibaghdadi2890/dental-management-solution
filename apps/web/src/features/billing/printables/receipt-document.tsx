import { formatReceiptNumber, fromCents, toCents } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { useChargeLabel } from '../payments/use-charge-label';
import { receiptQuery } from '../payments-api';
import { ItemsTable, Parties, PrintSheet, Totals } from './print-sheet';

/**
 * A receipt (B9: per payment, `RCT-`): who paid, for whom, how, and which charges it covered —
 * a household receipt lists each patient's part. Refunds are noted ("Refunded … on …"); a voided
 * receipt carries a VOID mark.
 */
export function ReceiptDocument({ paymentId }: { paymentId: string }) {
  const { t, i18n } = useTranslation(['printables', 'billing']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const receipt = useQuery(receiptQuery(paymentId));
  const chargeLabel = useChargeLabel();
  const data = receipt.data;
  const money = (amount: string) =>
    formatMoney({ amount, currency: data?.currency ?? 'USD' }, locale);
  const refunded = data
    ? data.refunds.reduce((sum, refund) => sum + toCents(refund.amount), 0n)
    : 0n;

  return (
    <PrintSheet
      title={t('receipt.title')}
      number={data ? formatReceiptNumber(data.receiptNumber) : ''}
      state={receipt.isError ? 'error' : data ? undefined : 'loading'}
      watermark={data?.voided ? t('void') : undefined}
    >
      {data && (
        <>
          <Parties
            columns={[
              { label: t('receipt.receivedFrom'), lines: [data.payer.name] },
              {
                label: data.rows.length > 1 ? t('receipt.patients') : t('receipt.patient'),
                lines: data.rows.map(
                  (row) => `${row.patient.fullName} · ${row.patient.displayNumber}`,
                ),
              },
              {
                label: t('receipt.payment'),
                lines: [
                  formatCalendarDate(data.paidAt, locale),
                  t(`billing:methods.${data.method}`),
                  data.reference ? t('receipt.reference', { reference: data.reference }) : null,
                ],
              },
            ]}
          />
          <ItemsTable
            headers={[t('receipt.patient'), t('receipt.appliedTo'), t('receipt.amount')]}
            numeric={[2]}
            rows={data.rows.flatMap((row) =>
              row.allocations.length > 0
                ? row.allocations.map((line) => [
                    row.patient.fullName,
                    chargeLabel(line),
                    money(line.amount),
                  ])
                : [[row.patient.fullName, '—', money(row.amount)]],
            )}
          />
          <Totals
            lines={[
              { label: t('receipt.total'), amount: money(data.total), strong: true },
              ...(refunded > 0n
                ? [{ label: t('receipt.refundedTotal'), amount: `−${money(fromCents(refunded))}` }]
                : []),
              ...data.rows.map((row) => ({
                label: t('receipt.balanceAfter', { name: row.patient.fullName }),
                amount: money(row.balanceAfter),
              })),
            ]}
          />
          <div className="mt-6 flex flex-col gap-1 text-[11.5px] text-ink-secondary">
            {data.refunds.map((refund, index) => (
              <p key={index} className="m-0">
                {t('receipt.refunded', {
                  amount: money(refund.amount),
                  date: formatCalendarDate(refund.on, locale),
                  reason: refund.reason,
                })}
              </p>
            ))}
            {data.voided && (
              <p className="m-0 font-medium text-danger">
                {t('receipt.voided', {
                  date: formatCalendarDate(data.voided.on, locale),
                  reason: data.voided.reason,
                })}
              </p>
            )}
            {data.recordedBy && (
              <p className="m-0">{t('receipt.recordedBy', { name: data.recordedBy })}</p>
            )}
          </div>
        </>
      )}
    </PrintSheet>
  );
}
