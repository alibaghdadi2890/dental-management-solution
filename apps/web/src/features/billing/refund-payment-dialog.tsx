import { formatReceiptNumber, type PaymentHistoryItem, toCents } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { accountQuery } from './payments-api';
import { RefundDialog } from './payments-screen/refund-dialog';
import { latestPayments, refundableOf } from './refundable-payments';

/**
 * Refund from the patient record: the patient's latest payments — receipt, date, method, amount
 * and what was refunded already, a voided or fully refunded one disabled — and, once one is
 * picked, the refund form (`RefundDialog`): all of what is left or part of it, with a method and
 * a reason, and **Back** to the list. Work charged at its start stays charged when it is
 * cancelled (ADR-0064); this is how its money goes back.
 */
export function RefundPaymentDialog({
  patientId,
  locale,
  onClose,
}: {
  patientId: string;
  locale: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['billing', 'common']);
  const account = useQuery(accountQuery(patientId));
  const [picked, setPicked] = useState<PaymentHistoryItem | null>(null);

  if (picked) {
    return (
      <RefundDialog
        payment={picked}
        locale={locale}
        onClose={onClose}
        onBack={() => {
          setPicked(null);
        }}
      />
    );
  }
  const payments = latestPayments(account.data?.history ?? []);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] animate-fadein bg-[rgba(27,26,31,.38)]" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-[60] flex max-h-[calc(100%-48px)] w-[calc(100%-48px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 animate-popin flex-col rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2">
          <div className="border-b border-inner-divider px-[22px] pt-[18px] pb-3.5">
            <Dialog.Title className="m-0 text-[16px] font-semibold">
              {t('refundPick.title')}
            </Dialog.Title>
            <Dialog.Description className="m-0 mt-1 text-[12.5px] text-ink-muted">
              {t('refundPick.body')}
            </Dialog.Description>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-[22px] py-[14px]">
            {account.isPending ? (
              <CardSkeleton label={t('refundPick.loading')} />
            ) : account.isError ? (
              <p role="alert" className="m-0 text-[12.5px] text-ink-muted">
                {t('balanceFailed')}
              </p>
            ) : payments.length === 0 ? (
              <p className="m-0 text-[12.5px] text-ink-muted">{t('refundPick.none')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {payments.map((payment) => {
                  const left = refundableOf(payment);
                  const money = (amount: string) =>
                    formatMoney({ amount, currency: payment.currency }, locale);
                  const state = payment.voided
                    ? t('refundPick.voided')
                    : left <= 0n
                      ? t('refundPick.fullyRefunded')
                      : toCents(payment.refunded) > 0n
                        ? t('refundPick.refunded', { amount: money(payment.refunded) })
                        : null;
                  return (
                    <li key={payment.id}>
                      <button
                        type="button"
                        disabled={left <= 0n}
                        onClick={() => {
                          setPicked(payment);
                        }}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-start',
                          left > 0n
                            ? 'cursor-pointer hover:border-primary'
                            : 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] leading-[1.35] font-semibold">
                            <span dir="ltr" className="font-mono">
                              {formatReceiptNumber(payment.receiptNumber)}
                            </span>
                            {' · '}
                            {formatCalendarDate(payment.paidAt, locale)}
                          </span>
                          <span className="block text-[12px] leading-snug text-ink-muted">
                            {[t(`methods.${payment.method}`), state].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span
                          dir="ltr"
                          className="flex-none font-mono text-[13px] leading-none font-semibold tabular-nums"
                        >
                          {money(payment.amount)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex justify-end border-t border-inner-divider bg-sunken px-[22px] py-3.5">
            <Dialog.Close asChild>
              <Button variant="secondary">{t('common:cancel')}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
