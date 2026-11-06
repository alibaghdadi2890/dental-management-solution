import {
  adjustmentEffect,
  fromCents,
  type PaymentMethod,
  type PayrollLine,
  type Session,
  toCents,
} from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Field, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { formatMonth } from '@/features/compensation/months';
import { MethodPicker } from '@/features/expenses/method-picker';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatMoney, todayIn } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { confirmLines, invalidatePayroll } from './payroll-api';

type Tenant = NonNullable<Session['tenant']>;

const NOTE_MAX = 500;

/**
 * Confirm one or several salary payments (B3): every line shows its base, adjustments and net
 * before the single confirmation, which sends each net as seen (a line changed meanwhile is
 * refused, not paid differently). One payment date, method and note for the batch.
 */
export function ConfirmLinesDialog({
  lines,
  tenant,
  onClose,
}: {
  lines: readonly PayrollLine[];
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['payroll', 'billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const today = todayIn(tenant.timeZone);
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const count = lines.length;
  const total = fromCents(lines.reduce((sum, line) => sum + toCents(line.net), 0n));
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);

  const submit = async () => {
    setTried(true);
    if (method === null || paidOn > today || saving) return;
    const request = {
      lines: lines.map((line) => ({
        employeeId: line.employeeId,
        month: line.month,
        paidOn,
        method,
        note: note.trim() === '' ? null : note.trim(),
        net: line.net,
      })),
    };
    setSaving(true);
    try {
      await confirmLines(request, keyFor(request));
      await invalidatePayroll(queryClient);
      toast(t('payroll:confirmMany.done', { count }), { tone: 'success' });
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
        onClick={saving ? undefined : onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('payroll:title')}
        title={t('payroll:confirmMany.title', { count })}
        subtitle={t('payroll:confirmMany.body')}
        dirty={false}
        onClose={onClose}
        closeDisabled={saving}
        initialFocus="field"
        className="fixed inset-y-0 end-0 z-40 w-[560px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <span className="me-auto text-[13px] text-ink-secondary">
              {t('payroll:confirmMany.total')}{' '}
              <span dir="ltr" className="font-mono font-semibold text-ink tabular-nums">
                {money(total)}
              </span>
            </span>
            <Button disabled={saving} onClick={onClose}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void submit()}>
              {t('payroll:confirmMany.submit', { count })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {lines.map((line) => (
              <li
                key={`${line.employeeId}:${line.month}`}
                className="rounded-lg border border-border px-3 py-2.5 text-[13px]"
              >
                <div className="flex items-center justify-between gap-3 font-medium">
                  <span>
                    {line.employeeName} · {formatMonth(line.month, locale)}
                  </span>
                  <span dir="ltr" className="font-mono font-semibold tabular-nums">
                    {money(line.net)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-muted">
                  <span>
                    {t('payroll:run.columns.base')}{' '}
                    <span dir="ltr">{line.base === null ? '—' : money(line.base)}</span>
                  </span>
                  {line.adjustments.length === 0 ? (
                    <span>{t('payroll:confirmMany.noAdjustments')}</span>
                  ) : (
                    line.adjustments.map((adjustment, index) => (
                      <span key={index}>
                        {adjustment.label}{' '}
                        <span dir="ltr">{money(fromCents(adjustmentEffect(adjustment)))}</span>
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Field
            label={t('payroll:confirmMany.paidOn')}
            error={tried && paidOn > today ? t('payroll:confirmMany.future') : undefined}
          >
            {(props) => (
              <DateInput
                {...props}
                value={paidOn}
                onChange={setPaidOn}
                order={dateInputOrder(tenant.country)}
                today={today}
                pickerLabel={t('payroll:confirmMany.chooseDate')}
              />
            )}
          </Field>
          <div>
            <MethodPicker
              label={t('payroll:confirmMany.method')}
              value={method}
              onChange={setMethod}
            />
            {tried && method === null && (
              <span className="mt-[5px] block text-xs font-medium text-danger">
                {t('payroll:confirmMany.methodRequired')}
              </span>
            )}
          </div>
          <Field label={t('payroll:confirmMany.note')} hint={t('payroll:confirmMany.optional')}>
            {(props) => (
              <TextInput
                {...props}
                value={note}
                maxLength={NOTE_MAX}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Field>
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
