import {
  ADJUSTMENT_REASONS,
  type AdjustmentReason,
  fromCents,
  type PatientAccount,
  type PatientBalance,
  type Session,
  toCents,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { invalidateVisitData } from '@/features/clinical/visits-list/visits-list-api';
import { patientQuery } from '@/features/patients/patients-api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatMoney, todayIn } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { cn } from '@/lib/utils';
import { adjustBalance } from '../billing-api';
import { MoneyInput } from '../money-input';
import { accountQuery, openPrintable, printPath } from '../payments-api';
import {
  type AdjustDirection,
  type AdjustDraft,
  adjustRequest,
  adjustStatus,
  fullAmount,
  initialAdjustDraft,
} from './adjust-draft';

type Tenant = NonNullable<Session['tenant']>;

const DIRECTIONS: readonly AdjustDirection[] = ['less', 'more'];
const NOTE_MAX = 200;
const FIGURE = 'font-mono leading-none tabular-nums';

const isReason = (value: string): value is AdjustmentReason =>
  ADJUSTMENT_REASONS.some((reason) => reason === value);

/**
 * The Adjust balance right panel (feature 7, H4): the patient and what they owe, the direction
 * in the clinic's words, the amount, a required reason (with a note that "Other" makes
 * required), the effective date, and the balance after — the primary button repeats the
 * direction and the amount, so nobody adds when they meant to reduce. It floats over whichever
 * screen opened it; Escape, the scrim and Cancel close it, after a discard prompt once anything
 * was typed.
 */
export function AdjustBalancePanel({
  patientId,
  tenant,
  onClose,
}: {
  patientId: string;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t } = useTranslation(['billing', 'common']);
  const confirm = useConfirm();
  const account = useQuery(accountQuery(patientId));
  const patient = useQuery(patientQuery(patientId));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

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

  return (
    <>
      <div
        aria-hidden
        onClick={close}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('adjust.eyebrow')}
        title={t('adjust.title')}
        subtitle={
          patient.data && (
            <p className="m-0 mt-[3px] text-[12.5px] leading-[1.4] text-ink-muted">
              {patient.data.fullName}
              {' · '}
              <span className="font-mono">{patient.data.displayNumber}</span>
            </p>
          )
        }
        dirty={dirty}
        onClose={close}
        closeDisabled={saving}
        initialFocus={account.data ? 'field' : 'heading'}
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        bodyClassName="p-0"
      >
        {account.data ? (
          <AdjustForm
            account={account.data}
            patientId={patientId}
            tenant={tenant}
            saving={saving}
            onSaving={setSaving}
            onDirty={setDirty}
            onCancel={close}
            onSaved={onClose}
          />
        ) : (
          <div className="p-[18px]">
            {account.isError ? (
              <p role="alert" className="m-0 text-[12.5px] text-ink-muted">
                {t('record.loadFailed')}
              </p>
            ) : (
              <CardSkeleton label={t('record.loading')} />
            )}
          </div>
        )}
      </RightPanel>
    </>
  );
}

function AdjustForm({
  account,
  patientId,
  tenant,
  saving,
  onSaving,
  onDirty,
  onCancel,
  onSaved,
}: {
  account: PatientAccount;
  patientId: string;
  tenant: Tenant;
  saving: boolean;
  onSaving: (saving: boolean) => void;
  onDirty: (dirty: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation(['billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const today = todayIn(tenant.timeZone);
  const [draft, setDraft] = useState<AdjustDraft>(() => initialAdjustDraft(today));
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();
  const directionId = useId();

  const balance = toCents(account.balance);
  const money = (cents: bigint) =>
    formatMoney({ amount: fromCents(cents), currency: account.currency }, locale);
  /** "Credit $20.00" for a negative balance, the plain amount otherwise. */
  const balanceText = (cents: bigint) =>
    cents < 0n ? t('adjust.credit', { amount: money(-cents) }) : money(cents);
  const set = (patch: Partial<AdjustDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
    onDirty(true);
  };
  const status = adjustStatus(draft, balance, locale, today);
  const full = fullAmount(balance);

  const submit = async () => {
    if (!status.ready || status.amount === null || saving) return;
    const request = adjustRequest(draft, status.amount);
    if (!request) return;
    onSaving(true);
    setError(null);
    let saved: PatientBalance;
    try {
      saved = await adjustBalance(patientId, request, keyFor({ patientId, ...request }));
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
      onSaving(false);
      return;
    }
    await invalidateVisitData(queryClient);
    toast(t('adjust.saved'), {
      tone: 'success',
      // The balance the server answered with, not the one worked out when the panel opened.
      body: t('adjust.after', {
        amount: balanceText(
          toCents(
            saved.balances.find((money) => money.currency === account.currency)?.amount ?? '0',
          ),
        ),
      }),
      actionLabel: t('balance.statement'),
      onAction: () => {
        openPrintable(printPath.statement(patientId));
      },
    });
    onSaving(false);
    onSaved();
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-[18px]">
        <div className="flex items-center justify-between rounded-lg border border-border bg-faint px-3.5 py-3">
          <span className="text-[12.5px] font-medium text-ink-secondary">
            {t('adjust.current')}
          </span>
          <span
            dir="ltr"
            className={cn(
              FIGURE,
              'text-[17px] font-bold',
              balance > 0n ? 'text-danger' : balance < 0n ? 'text-success' : 'text-ink-muted',
            )}
          >
            {balanceText(balance)}
          </span>
        </div>

        <div>
          <div id={directionId} className="mb-1.5 text-[12.5px] leading-none font-medium">
            {t('adjust.direction')}
          </div>
          <div
            role="radiogroup"
            aria-labelledby={directionId}
            className="grid grid-cols-2 gap-0.5 rounded-lg border border-border-control bg-sunken p-0.5"
          >
            {DIRECTIONS.map((direction) => (
              <button
                key={direction}
                type="button"
                role="radio"
                aria-checked={draft.direction === direction}
                onClick={() => {
                  set({ direction });
                }}
                className={cn(
                  'h-[34px] cursor-pointer rounded-[6px] border-0 px-2 text-[12.5px] font-medium',
                  draft.direction === direction
                    ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(27,26,31,.14)]'
                    : 'bg-transparent text-ink-secondary hover:text-ink',
                )}
              >
                {t(`adjust.directions.${direction}`)}
              </button>
            ))}
          </div>
          <p className="m-0 mt-1.5 text-[12px] leading-snug text-ink-muted">
            {t(`adjust.directionHint.${draft.direction}`)}
          </p>
        </div>

        <div>
          <label htmlFor={amountId} className="mb-1.5 block text-[12.5px] leading-none font-medium">
            {t('adjust.amount')}
          </label>
          <MoneyInput
            id={amountId}
            value={draft.amountText}
            onChange={(amountText) => {
              set({ amountText });
            }}
            currency={account.currency}
            locale={locale}
            aria-invalid={status.problem !== null}
            className="h-11 text-[18px] font-semibold"
          />
          {draft.direction === 'less' && full > 0n && (
            <button
              type="button"
              onClick={() => {
                set({ amountText: fromCents(full) });
              }}
              className="mt-2 h-[30px] cursor-pointer rounded-[15px] border border-border-control bg-surface px-3 text-[12px] font-medium hover:border-primary hover:text-primary"
            >
              {t('record.full', { amount: money(full) })}
            </button>
          )}
          {status.problem && (
            <p role="alert" className="m-0 mt-1.5 text-[12px] font-medium text-danger">
              {t(`record.problem.${status.problem}`)}
            </p>
          )}
        </div>

        <Field label={t('adjust.reason')}>
          {(field) => (
            <Select
              {...field}
              value={draft.reason}
              onChange={(event) => {
                const { value } = event.target;
                set({ reason: isReason(value) ? value : '' });
              }}
            >
              <option value="" disabled>
                {t('adjust.chooseReason')}
              </option>
              {ADJUSTMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {t(`adjust.reasons.${reason}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('adjust.note')}
          hint={draft.reason === 'other' ? undefined : t('record.optional')}
          error={
            status.noteMissing && draft.note.trim() !== '' ? t('adjust.noteRequired') : undefined
          }
        >
          {(field) => (
            <TextInput
              {...field}
              value={draft.note}
              maxLength={NOTE_MAX}
              placeholder={draft.reason === 'other' ? t('adjust.noteRequired') : undefined}
              onChange={(event) => {
                set({ note: event.target.value });
              }}
            />
          )}
        </Field>

        <Field label={t('adjust.date')}>
          {(field) => (
            <DateInput
              {...field}
              value={draft.effectiveDate}
              onChange={(effectiveDate) => {
                set({ effectiveDate });
              }}
              order={dateInputOrder(tenant.country)}
              today={today}
              pickerLabel={t('adjust.chooseDate')}
            />
          )}
        </Field>

        <div
          aria-live="polite"
          className="flex items-center justify-between border-t border-divider-strong pt-3"
        >
          <span className="text-[13px] leading-none font-semibold">{t('adjust.afterLabel')}</span>
          <span
            dir="ltr"
            className={cn(
              FIGURE,
              'text-[17px] font-bold',
              status.after === null
                ? 'text-ink-muted'
                : status.after > 0n
                  ? 'text-danger'
                  : status.after < 0n
                    ? 'text-success'
                    : 'text-ink',
            )}
          >
            {status.after === null ? '—' : balanceText(status.after)}
          </span>
        </div>

        {error && (
          <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-none items-center justify-end gap-2 border-t border-inner-divider px-[18px] py-3">
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          {t('common:cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!status.ready}
          busy={saving}
          onClick={() => void submit()}
        >
          {status.amount === null
            ? t('adjust.submit')
            : t(`adjust.submitDirection.${draft.direction}`, { amount: money(status.amount) })}
        </Button>
      </div>
    </>
  );
}
