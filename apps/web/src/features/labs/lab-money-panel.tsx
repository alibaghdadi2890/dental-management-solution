import type { Lab, LabAdjustmentKind, PaymentMethod, Session } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { Field, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { MoneyInput } from '@/features/billing/money-input';
import { Segmented } from '@/features/compensation/segmented';
import { MethodPicker } from '@/features/expenses/method-picker';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatMoney, todayIn } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import {
  invalidateLabs,
  recordLabAdjustment,
  recordLabPayment,
  setOpeningBalance,
} from './labs-api';

type Tenant = NonNullable<Session['tenant']>;
export type LabMoneyKind = 'payment' | 'adjustment' | 'opening';

/**
 * The lab account's forms (Part D), each in a right panel over the lab's page:
 *
 * - **Record payment** — amount (with *Pay what is outstanding* when something is), date,
 *   method, the lab's invoice or receipt number and a note; it is mirrored into Expenses under
 *   Lab fees.
 * - **Adjustment** — a credit (the clinic owes less) or a charge (it owes more), dated, with a
 *   reason.
 * - **Opening balance** — what the clinic owed the lab when it started using the system;
 *   negative when the lab owed the clinic.
 */
export function LabMoneyPanel({
  kind,
  lab,
  outstanding,
  tenant,
  onClose,
}: {
  kind: LabMoneyKind;
  lab: Lab;
  /** The account's outstanding, when known: offered as the payment's amount. */
  outstanding: string | undefined;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const noteId = useId();
  const today = todayIn(tenant.timeZone);
  const [date, setDate] = useState(kind === 'opening' ? (lab.openingBalanceOn ?? today) : today);
  const [amountText, setAmountText] = useState(
    kind === 'opening' ? (lab.openingBalance ?? '') : '',
  );
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [adjustment, setAdjustment] = useState<LabAdjustmentKind>('credit');
  const [reference, setReference] = useState('');
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);

  const amount = parseAmount(amountText, locale);
  const owing = outstanding !== undefined && Number(outstanding) > 0 ? outstanding : undefined;
  const problems = {
    amount:
      amount === ''
        ? t('labs:form.problems.required')
        : amount === null ||
            (kind !== 'opening' && (amount.startsWith('-') || Number(amount) === 0))
          ? t('labs:form.problems.amount')
          : undefined,
    date:
      date === '' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        ? t('labs:form.problems.date')
        : date > today
          ? t('labs:dialogs.dateInFuture')
          : undefined,
    method: kind === 'payment' && method === null ? t('labs:form.problems.method') : undefined,
    reason:
      kind === 'adjustment' && text.trim().length < 3 ? t('labs:form.problems.reason') : undefined,
  };
  const ready = Object.values(problems).every((problem) => problem === undefined);
  const shown = (field: keyof typeof problems) => (tried ? problems[field] : undefined);
  const touch = () => {
    setDirty(true);
    setError(undefined);
  };

  const close = () => {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    confirm({
      title: t('common:discardTitle'),
      body: t('common:discardBody'),
      okLabel: t('common:discardLeave'),
      cancelLabel: t('common:keepEditing'),
      tone: 'warn',
      onConfirm: onClose,
    });
  };

  const submit = async () => {
    setTried(true);
    if (!ready || saving || amount === null || amount === '') return;
    setSaving(true);
    const optional = (value: string) => (value.trim() === '' ? null : value.trim());
    try {
      if (kind === 'payment' && method) {
        const body = {
          paidOn: date,
          amount,
          method,
          reference: optional(reference),
          note: optional(text),
        };
        await recordLabPayment(lab.id, body, keyFor(body));
      } else if (kind === 'adjustment') {
        const body = { onDate: date, kind: adjustment, amount, reason: text.trim() };
        await recordLabAdjustment(lab.id, body, keyFor(body));
      } else {
        await setOpeningBalance(lab.id, { amount, asOf: date });
      }
      await invalidateLabs(queryClient);
      toast(t(`labs:money.${kind}.saved`), { tone: 'success' });
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        aria-hidden
        onClick={close}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={lab.name}
        title={t(`labs:money.${kind}.title`)}
        dirty={dirty}
        onClose={close}
        closeDisabled={saving}
        initialFocus="field"
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button disabled={saving} onClick={close}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void submit()}>
              {t(`labs:money.${kind}.save`)}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-[13px]">
          {kind === 'adjustment' && (
            <div>
              <Segmented
                label={t('labs:money.adjustment.kind')}
                value={adjustment}
                options={[
                  { value: 'credit', label: t('labs:money.adjustment.credit') },
                  { value: 'charge', label: t('labs:money.adjustment.charge') },
                ]}
                onChange={(value) => {
                  setAdjustment(value);
                  touch();
                }}
              />
              <p className="m-0 mt-1.5 text-[12px] text-ink-muted">
                {t(`labs:money.adjustment.${adjustment}Hint`)}
              </p>
            </div>
          )}
          <Field
            label={
              kind === 'opening' ? t('labs:money.opening.amount') : t('labs:money.payment.amount')
            }
            error={shown('amount')}
          >
            {(props) => (
              <MoneyInput
                {...props}
                value={amountText}
                onChange={(value) => {
                  setAmountText(value);
                  touch();
                }}
                currency={tenant.currency}
                locale={locale}
                className="h-11 text-[18px] font-semibold"
              />
            )}
          </Field>
          {kind === 'payment' && owing !== undefined && (
            <div className="-mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-secondary">
              <span>{t('labs:money.payment.outstanding', { amount: money(owing) })}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAmountText(owing);
                  touch();
                }}
              >
                {t('labs:money.payment.payAll')}
              </Button>
            </div>
          )}
          {kind === 'opening' && (
            <p className="-mt-2 m-0 text-[12px] text-ink-muted">
              {t('labs:money.opening.amountHint')}
            </p>
          )}
          <Field label={t(`labs:money.${kind}.date`)} error={shown('date')}>
            {(props) => (
              <DateInput
                {...props}
                value={date}
                onChange={(value) => {
                  setDate(value);
                  touch();
                }}
                order={dateInputOrder(tenant.country)}
                today={today}
                pickerLabel={t('labs:dialogs.chooseDate')}
              />
            )}
          </Field>
          {kind === 'payment' && (
            <div>
              <MethodPicker
                label={t('labs:money.payment.method')}
                value={method}
                onChange={(value) => {
                  setMethod(value);
                  touch();
                }}
              />
              {shown('method') && (
                <span className="mt-[5px] block text-xs leading-tight font-medium text-danger">
                  {shown('method')}
                </span>
              )}
            </div>
          )}
          {kind === 'payment' && (
            <Field label={t('labs:money.payment.reference')} hint={t('labs:dialogs.optional')}>
              {(props) => (
                <TextInput
                  {...props}
                  value={reference}
                  maxLength={100}
                  onChange={(event) => {
                    setReference(event.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
          )}
          {kind !== 'opening' && (
            <div>
              <label
                htmlFor={noteId}
                className="mb-1.5 flex justify-between text-[12.5px] leading-none font-medium"
              >
                <span>
                  {kind === 'payment'
                    ? t('labs:money.payment.note')
                    : t('labs:money.adjustment.reason')}
                </span>
                {kind === 'payment' && (
                  <span className="font-normal text-ink-muted">{t('labs:dialogs.optional')}</span>
                )}
              </label>
              <textarea
                id={noteId}
                value={text}
                rows={2}
                maxLength={500}
                aria-invalid={Boolean(shown('reason'))}
                onChange={(event) => {
                  setText(event.target.value);
                  touch();
                }}
                className="block w-full resize-y rounded-lg border border-border-control bg-surface px-[11px] py-2 text-[13px] leading-[1.5] text-ink aria-invalid:border-danger"
              />
              {shown('reason') && (
                <span className="mt-[5px] block text-xs leading-tight font-medium text-danger">
                  {shown('reason')}
                </span>
              )}
            </div>
          )}
          {kind === 'payment' && (
            <p className="m-0 rounded-lg bg-faint px-3 py-2 text-[12px] text-ink-secondary">
              {t('labs:money.payment.mirrorHint')}
            </p>
          )}
          {error && (
            <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </RightPanel>
    </>
  );
}
