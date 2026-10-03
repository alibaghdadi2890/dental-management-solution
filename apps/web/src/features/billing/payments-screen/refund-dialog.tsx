import {
  formatReceiptNumber,
  fromCents,
  PAYMENT_METHODS,
  type PaymentMethod,
  toCents,
  type Transaction,
} from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast-context';
import { invalidateVisitData } from '@/features/clinical/visits-list/visits-list-api';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { MoneyInput } from '../money-input';
import { refundPayment } from '../payments-api';

const REASON_MIN = 3;

/**
 * Refund part or all of a payment (B6, P6): the amount (what is left of it by default), the
 * method (the payment's by default) and a required reason. It reopens what the payment covered.
 */
export function RefundDialog({
  payment,
  locale,
  onClose,
}: {
  payment: Transaction;
  locale: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['payments', 'billing', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const left = toCents(payment.amount) - toCents(payment.refunded);
  const [amountText, setAmountText] = useState(fromCents(left));
  const [method, setMethod] = useState<PaymentMethod>(payment.method);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();
  const reasonId = useId();
  const parsed = parseAmount(amountText, locale);
  const amount = parsed === null ? null : toCents(parsed);
  const amountProblem = amount === null || amount <= 0n ? 'invalid' : amount > left ? 'over' : null;
  const money = (cents: bigint) =>
    formatMoney({ amount: fromCents(cents), currency: payment.currency }, locale);
  const valid = amountProblem === null && reason.trim().length >= REASON_MIN;

  const submit = async () => {
    if (!valid || amount === null) return;
    setSaving(true);
    setError(null);
    try {
      await refundPayment(payment.id, { amount: fromCents(amount), reason: reason.trim(), method });
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
      setSaving(false);
      return;
    }
    await invalidateVisitData(queryClient);
    toast(t('refund.done', { amount: money(amount) }), { tone: 'success' });
    onClose();
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] animate-fadein bg-[rgba(27,26,31,.38)]" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-[60] w-[calc(100%-48px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 animate-popin rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2">
          <div className="border-b border-inner-divider px-[22px] pt-[18px] pb-3.5">
            <Dialog.Title className="m-0 text-[16px] font-semibold">
              {t('refund.title', { receipt: formatReceiptNumber(payment.receiptNumber) })}
            </Dialog.Title>
            <Dialog.Description className="m-0 mt-1 text-[12.5px] text-ink-muted">
              {t('refund.body', { patient: payment.patient.fullName, amount: money(left) })}
            </Dialog.Description>
          </div>
          <div className="flex flex-col gap-3.5 px-[22px] py-[18px]">
            <div>
              <label htmlFor={amountId} className="mb-1.5 block text-[12.5px] font-medium">
                {t('refund.amount')}
              </label>
              <MoneyInput
                id={amountId}
                value={amountText}
                onChange={setAmountText}
                currency={payment.currency}
                locale={locale}
                aria-invalid={amountProblem !== null}
              />
              {amountProblem && amountText.trim() !== '' && (
                <p role="alert" className="m-0 mt-1 text-[12px] text-danger">
                  {t(`refund.problem.${amountProblem}`, { amount: money(left) })}
                </p>
              )}
            </div>
            <Field label={t('refund.method')}>
              {(field) => (
                <Select
                  {...field}
                  value={method}
                  onChange={(event) => {
                    const next = PAYMENT_METHODS.find((option) => option === event.target.value);
                    if (next) setMethod(next);
                  }}
                >
                  {PAYMENT_METHODS.map((option) => (
                    <option key={option} value={option}>
                      {t(`billing:methods.${option}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div>
              <label htmlFor={reasonId} className="mb-1.5 block text-[12.5px] font-medium">
                {t('refund.reason')}
              </label>
              <textarea
                id={reasonId}
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                className="w-full rounded-lg border border-border-control bg-surface px-[11px] py-2 text-[13px] leading-snug"
              />
            </div>
            {error && (
              <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2.5 border-t border-inner-divider bg-sunken px-[22px] py-3.5">
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={saving}>
                {t('common:cancel')}
              </Button>
            </Dialog.Close>
            <Button
              variant="dangerSolid"
              disabled={!valid || saving}
              busy={saving}
              onClick={() => void submit()}
            >
              {t('refund.submit')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
