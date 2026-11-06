import { PAYROLL_ADJUSTMENT_KINDS, type PayrollLine } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { formatMonth } from '@/features/compensation/months';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type AdjustmentRow, preview, readRow, rowsFrom } from './adjustments-form';
import { invalidatePayroll, setAdjustments } from './payroll-api';

const LABEL_MAX = 80;

/**
 * Adjust a pending line (B3): any number of bonuses, deductions (typed positive, they subtract)
 * and others (signed), each with a label; the net is shown live and never below zero — deductions
 * larger than the salary can't be saved.
 */
export function AdjustmentsDialog({ line, onClose }: { line: PayrollLine; onClose: () => void }) {
  const { t, i18n } = useTranslation(['payroll', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<AdjustmentRow[]>(() => rowsFrom(line.adjustments));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const shown = preview(line.base, rows, locale);
  const money = (amount: string) => formatMoney({ amount, currency: line.currency }, locale);

  const change = (index: number, patch: Partial<AdjustmentRow>) => {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
    setError(undefined);
  };

  const save = async () => {
    setTried(true);
    if (!shown.adjustments || shown.negative || saving) return;
    setSaving(true);
    try {
      await setAdjustments(line.month, line.employeeId, shown.adjustments);
      await invalidatePayroll(queryClient);
      toast(t('payroll:adjust.saved'), { tone: 'success' });
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
        title={t('payroll:adjust.title', {
          name: line.employeeName,
          month: formatMonth(line.month, locale),
        })}
        subtitle={t('payroll:adjust.body')}
        dirty={false}
        onClose={onClose}
        closeDisabled={saving}
        className="fixed inset-y-0 end-0 z-40 w-[560px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button disabled={saving} onClick={onClose}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void save()}>
              {t('payroll:adjust.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-secondary">{t('payroll:adjust.base')}</span>
            <span dir="ltr" className="font-mono tabular-nums">
              {line.base === null ? t('payroll:run.noSalary') : money(line.base)}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((row, index) => {
              const read = readRow(row, locale);
              const problem = tried && 'problem' in read ? read.problem : undefined;
              return (
                // Rows have no id until saved: their position is their identity while editing.
                <li key={index} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Select
                      aria-label={t('payroll:adjust.kind')}
                      value={row.kind}
                      onChange={(event) => {
                        const kind = PAYROLL_ADJUSTMENT_KINDS.find(
                          (value) => value === event.target.value,
                        );
                        if (kind) change(index, { kind });
                      }}
                      className="w-[120px]"
                    >
                      {PAYROLL_ADJUSTMENT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {t(`payroll:adjustmentKinds.${kind}`)}
                        </option>
                      ))}
                    </Select>
                    <TextInput
                      aria-label={t('payroll:adjust.label')}
                      placeholder={t('payroll:adjust.label')}
                      value={row.label}
                      maxLength={LABEL_MAX}
                      aria-invalid={problem === 'label'}
                      onChange={(event) => {
                        change(index, { label: event.target.value });
                      }}
                      className="flex-1"
                    />
                    <TextInput
                      aria-label={t('payroll:adjust.amount')}
                      dir="ltr"
                      inputMode="decimal"
                      value={row.amountText}
                      aria-invalid={problem === 'amount' || problem === 'signed'}
                      onChange={(event) => {
                        change(index, { amountText: event.target.value });
                      }}
                      className="w-[110px] text-end font-mono"
                    />
                    <IconButton
                      aria-label={t('payroll:adjust.remove', {
                        label: row.label || t(`payroll:adjustmentKinds.${row.kind}`),
                      })}
                      onClick={() => {
                        setRows((current) => current.filter((_, at) => at !== index));
                      }}
                    >
                      <span aria-hidden>×</span>
                    </IconButton>
                  </div>
                  {problem && (
                    <span className="text-xs font-medium text-danger">
                      {t(`payroll:adjust.problems.${problem}`)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRows((current) => [...current, { kind: 'bonus', label: '', amountText: '' }]);
              }}
            >
              {t('payroll:adjust.add')}
            </Button>
          </div>
          <div
            className={cn(
              'flex items-center justify-between border-t border-border pt-3 text-[14px] font-semibold',
              shown.negative && 'text-danger',
            )}
          >
            <span>{t('payroll:adjust.net')}</span>
            <span dir="ltr" className="font-mono tabular-nums">
              {money(shown.net)}
            </span>
          </div>
          {shown.negative && (
            <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
              {t('payroll:adjust.negative')}
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
