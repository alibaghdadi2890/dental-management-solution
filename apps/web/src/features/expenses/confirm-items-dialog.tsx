import type { FixedItem, Session } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Field } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { MoneyInput } from '@/features/billing/money-input';
import { formatMonth } from '@/features/compensation/months';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatMoney, todayIn } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { batchTotal, type ConfirmRow, confirmRequest, rowAmount, rowsOf } from './confirm-items';
import { confirmItems, invalidateExpenses } from './expenses-api';
import { MethodPicker } from './method-picker';

type Tenant = NonNullable<Session['tenant']>;

/**
 * Confirm several waiting months at once (A3): each row shows its own amount (editable, the bill
 * varies) and method; one payment date; one *Confirm N expenses* records them all. The rest of
 * each expense is the month as generated; a row is edited later like any expense.
 */
export function ConfirmItemsDialog({
  items,
  tenant,
  onClose,
}: {
  items: readonly FixedItem[];
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['expenses', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const today = todayIn(tenant.timeZone);
  const [rows, setRows] = useState<ConfirmRow[]>(() => rowsOf(items));
  const [date, setDate] = useState(today);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const count = rows.length;

  const change = (index: number, patch: Partial<ConfirmRow>) => {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
    setError(undefined);
  };

  const submit = async () => {
    setTried(true);
    const request = date > today ? null : confirmRequest(rows, date, locale);
    if (!request || saving) return;
    setSaving(true);
    try {
      await confirmItems(request, keyFor(request));
      await invalidateExpenses(queryClient);
      toast(t('expenses:confirmMany.done', { count }), { tone: 'success' });
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
        eyebrow={t('expenses:pending.title')}
        title={t('expenses:confirmMany.title', { count })}
        subtitle={t('expenses:confirmMany.body')}
        dirty={false}
        onClose={onClose}
        closeDisabled={saving}
        initialFocus="field"
        className="fixed inset-y-0 end-0 z-40 w-[560px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <span className="me-auto text-[13px] text-ink-secondary">
              {t('expenses:confirmMany.total')}{' '}
              <span dir="ltr" className="font-mono font-semibold text-ink tabular-nums">
                {formatMoney(
                  { amount: batchTotal(rows, locale), currency: tenant.currency },
                  locale,
                )}
              </span>
            </span>
            <Button disabled={saving} onClick={onClose}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void submit()}>
              {t('expenses:confirmMany.submit', { count })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label={t('expenses:panel.date')}
            error={tried && date > today ? t('expenses:panel.problems.future') : undefined}
          >
            {(props) => (
              <DateInput
                {...props}
                value={date}
                onChange={setDate}
                order={dateInputOrder(tenant.country)}
                today={today}
                pickerLabel={t('expenses:panel.chooseDate')}
              />
            )}
          </Field>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {rows.map((row, index) => {
              const read = rowAmount(row, locale);
              const label = t('expenses:confirmMany.row', {
                name: row.item.name,
                month: formatMonth(row.item.month, locale),
              });
              return (
                <li
                  key={row.item.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium">{label}</span>
                    <Field
                      label={<span className="sr-only">{label}</span>}
                      error={
                        tried && 'problem' in read
                          ? t(`expenses:panel.problems.${read.problem}`)
                          : undefined
                      }
                      className="w-[150px]"
                    >
                      {(props) => (
                        <MoneyInput
                          {...props}
                          value={row.amountText}
                          onChange={(text) => {
                            change(index, { amountText: text });
                          }}
                          currency={tenant.currency}
                          locale={locale}
                        />
                      )}
                    </Field>
                  </div>
                  <MethodPicker
                    compact
                    label={`${t('expenses:panel.method')} · ${label}`}
                    value={row.method}
                    onChange={(method) => {
                      change(index, { method });
                    }}
                  />
                  {tried && row.method === null && (
                    <span className="text-xs font-medium text-danger">
                      {t('expenses:panel.problems.required')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
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
