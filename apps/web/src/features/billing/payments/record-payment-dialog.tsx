import {
  fromCents,
  PAYMENT_METHODS,
  type PatientAccount,
  type RecordPaymentResult,
  type Session,
  toCents,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, TextInput } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { invalidateVisitData } from '@/features/clinical/visits-list/visits-list-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatMoney, todayIn } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { billingKeys } from '../billing-api';
import { MoneyInput } from '../money-input';
import {
  accountQuery,
  openPrintable,
  previewPayment,
  printPath,
  recordPayment,
} from '../payments-api';
import type { PaymentRequestOptions } from './payment-dialog-context';
import { useChargeLabel } from './use-charge-label';
import {
  capOf,
  halfOf,
  initialDraft,
  type PaymentDraft,
  requestOf,
  statusOf,
} from './payment-draft';

type Tenant = NonNullable<Session['tenant']>;

const FIGURE = 'font-mono leading-none tabular-nums';
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * The Record payment modal (workspace spec §Record Payment; feature 5 §Screens 1): what is owed,
 * the amount taken now (empty, the outstanding as placeholder, Full / Half chips), the method,
 * date and reference, the payer, the household switch (B5), "Apply to a specific visit" (B4),
 * what remains and the allocation preview from the server's dry run. A payment is one
 * Idempotency-Key for the life of the modal, so a retry after a lost response never pays twice.
 */
export function RecordPaymentDialog({
  options,
  tenant,
  onClose,
}: {
  options: PaymentRequestOptions;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t } = useTranslation('billing');
  const account = useQuery(accountQuery(options.patientId, options.payerContactId));
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] animate-fadein bg-[rgba(27,26,31,.38)]" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-[60] flex max-h-[calc(100%-48px)] w-[calc(100%-48px)] max-w-[452px] -translate-x-1/2 -translate-y-1/2 animate-popin flex-col overflow-hidden rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2">
          <div className="border-b border-inner-divider px-[22px] pt-[18px] pb-3.5">
            <Dialog.Title className="m-0 text-[16.5px] leading-[1.2] font-semibold">
              {t('record.title')}
            </Dialog.Title>
            <Dialog.Description className="m-0 mt-1 text-[12.5px] leading-snug text-ink-muted">
              {options.contextVisitId ? t('record.ruleVisit') : t('record.rulePatient')}
            </Dialog.Description>
          </div>
          {account.data ? (
            <PaymentForm
              account={account.data}
              options={options}
              tenant={tenant}
              onClose={onClose}
            />
          ) : (
            <div className="px-[22px] py-5">
              {account.isError ? (
                <p role="alert" className="m-0 text-[12.5px] text-ink-muted">
                  {t('record.loadFailed')}
                </p>
              ) : (
                <CardSkeleton label={t('record.loading')} />
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaymentForm({
  account,
  options,
  tenant,
  onClose,
}: {
  account: PatientAccount;
  options: PaymentRequestOptions;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = todayIn(tenant.timeZone);
  const preselected = options.preselectVisitId
    ? account.openCharges.find((charge) => charge.visitId === options.preselectVisitId)?.entryId
    : undefined;
  const [draft, setDraft] = useState<PaymentDraft>(() =>
    initialDraft(today, preselected, options.household === true && account.household !== null),
  );
  const [advanced, setAdvanced] = useState(preselected !== undefined);
  const [choosingPayer, setChoosingPayer] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();
  const chargeLabel = useChargeLabel();

  const money = (cents: bigint) =>
    formatMoney({ amount: fromCents(cents), currency: account.currency }, locale);
  const set = (patch: Partial<PaymentDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };
  const status = statusOf(draft, account, locale);
  const cap = capOf(draft, account);
  const valid = status.amount !== null && status.problem === null && draft.paidAt !== '';
  const context = {
    patientId: options.patientId,
    contextVisitId: options.contextVisitId,
    payerContactId: options.payerContactId,
  };
  const request =
    valid && status.amount !== null ? requestOf(draft, account, status.amount, context) : null;
  const previewKey = useDebouncedValue(request ? JSON.stringify(request) : '', PREVIEW_DEBOUNCE_MS);
  const preview = useQuery({
    queryKey: [...billingKeys.all(actingTenantId()), 'payment-preview', previewKey],
    queryFn: ({ signal }) =>
      previewPayment(JSON.parse(previewKey) as Parameters<typeof previewPayment>[0], signal),
    enabled: previewKey !== '' && previewKey === (request ? JSON.stringify(request) : ''),
  });

  const payers = [
    { contactId: null, name: t('record.patientPays') },
    ...account.payers.map((payer) => ({ contactId: payer.contactId, name: payer.name })),
  ];
  const payerName =
    draft.payerContactId === undefined
      ? account.payer.contactId === null
        ? t('record.patientPays')
        : account.payer.name
      : (payers.find((payer) => payer.contactId === draft.payerContactId)?.name ?? '');

  const submit = async () => {
    if (!request || status.amount === null) return;
    setSaving(true);
    setError(null);
    const before = cap;
    let result: RecordPaymentResult;
    try {
      result = await recordPayment(request, key);
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
      setSaving(false);
      return;
    }
    await invalidateVisitData(queryClient);
    // Computed from the pre-payment total, not from refreshed data (spec §Record Payment).
    const left = before - status.amount;
    toast(t('record.recorded', { amount: money(status.amount) }), {
      tone: 'success',
      body: left > 0n ? t('record.stillOwed', { amount: money(left) }) : t('record.clear'),
      actionLabel: t('record.receipt'),
      onAction: () => {
        const [first] = result.paymentIds;
        if (first) openPrintable(printPath.receipt(first));
      },
    });
    options.onRecorded?.(result);
    onClose();
  };

  return (
    <>
      <div className="flex min-h-0 flex-col gap-4 overflow-auto px-[22px] py-[18px]">
        <div className="flex items-center justify-between rounded-lg border border-border bg-faint px-3.5 py-3">
          <span className="text-[12.5px] font-medium text-ink-secondary">
            {t('record.outstanding')}
          </span>
          <span dir="ltr" className={cn(FIGURE, 'text-[17px] font-bold')}>
            {money(cap)}
          </span>
        </div>

        {account.household && draft.payerContactId === undefined && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5">
            <span className="text-[12.5px] leading-snug">
              {draft.household
                ? t('record.householdOn', {
                    count: account.household.patients.length,
                    total: formatMoney(
                      { amount: account.household.total, currency: account.currency },
                      locale,
                    ),
                  })
                : t('record.householdOff')}
            </span>
            <Switch
              checked={draft.household}
              onCheckedChange={(household) => {
                set({ household, targetEntryId: household ? undefined : draft.targetEntryId });
              }}
              label={t('record.householdLabel')}
            />
          </div>
        )}

        <div>
          <label htmlFor={amountId} className="mb-1.5 block text-[12.5px] leading-none font-medium">
            {t('record.amount')}
          </label>
          <MoneyInput
            id={amountId}
            autoFocus
            value={draft.amountText}
            onChange={(amountText) => {
              set({ amountText });
            }}
            currency={account.currency}
            locale={locale}
            placeholder={fromCents(cap)}
            aria-invalid={status.problem !== null}
            className="h-11 text-[18px] font-semibold"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip
              onClick={() => {
                set({ amountText: fromCents(cap) });
              }}
              disabled={cap <= 0n}
            >
              {t('record.full', { amount: money(cap) })}
            </Chip>
            <Chip
              onClick={() => {
                set({ amountText: halfOf(cap) });
              }}
              disabled={cap <= 1n}
            >
              {t('record.half', { amount: money(toCents(halfOf(cap))) })}
            </Chip>
            {draft.amountText === '' && (
              <span className="text-[12px] text-ink-muted">{t('record.partialHint')}</span>
            )}
          </div>
          {status.problem && (
            <p role="alert" className="m-0 mt-1.5 text-[12px] font-medium text-danger">
              {t(`record.problem.${status.problem}`, { amount: money(cap) })}
            </p>
          )}
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1.5 text-[12.5px] leading-none font-medium">
            {t('record.method')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                aria-pressed={draft.method === method}
                onClick={() => {
                  set({ method });
                }}
                className={cn(
                  'h-[34px] cursor-pointer rounded-[7px] border px-3 text-[12.5px] font-medium',
                  draft.method === method
                    ? 'border-ink bg-ink text-white'
                    : 'border-border-control bg-surface text-ink hover:border-ink',
                )}
              >
                {t(`methods.${method}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Field label={t('record.date')}>
            {(field) => (
              <DateInput
                {...field}
                value={draft.paidAt}
                onChange={(paidAt) => {
                  set({ paidAt });
                }}
                order={dateInputOrder(tenant.country)}
                today={today}
                pickerLabel={t('record.chooseDate')}
              />
            )}
          </Field>
          <Field label={t('record.reference')}>
            {(field) => (
              <TextInput
                {...field}
                value={draft.reference}
                maxLength={80}
                placeholder={t('record.optional')}
                onChange={(event) => {
                  set({ reference: event.target.value });
                }}
              />
            )}
          </Field>
        </div>

        <div className="text-[12.5px] leading-snug text-ink-secondary">
          {choosingPayer ? (
            <Field label={t('record.payer')}>
              {(field) => (
                <Select
                  {...field}
                  value={
                    draft.payerContactId === undefined
                      ? 'default'
                      : (draft.payerContactId ?? 'patient')
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    set({
                      payerContactId:
                        value === 'default' ? undefined : value === 'patient' ? null : value,
                      household: value === 'default' ? draft.household : false,
                    });
                  }}
                >
                  <option value="default">
                    {t('record.defaultPayer', {
                      name: payerNameOf(account, t('record.patientPays')),
                    })}
                  </option>
                  {payers.map((payer) => (
                    <option key={payer.contactId ?? 'patient'} value={payer.contactId ?? 'patient'}>
                      {payer.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <span>
              {t('record.payerLine', { name: payerName })}{' '}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-medium text-primary hover:underline"
                onClick={() => {
                  setChoosingPayer(true);
                }}
              >
                {t('record.change')}
              </button>
            </span>
          )}
        </div>

        {!draft.household && account.openCharges.length > 1 && (
          <details
            open={advanced}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setAdvanced(open);
              if (!open) set({ targetEntryId: undefined });
            }}
            className="rounded-lg border border-border px-3.5 py-2.5"
          >
            <summary className="cursor-pointer text-[12.5px] font-medium">
              {t('record.specific')}
            </summary>
            <Field label={t('record.specificLabel')} className="mt-2.5">
              {(field) => (
                <Select
                  {...field}
                  value={draft.targetEntryId ?? ''}
                  onChange={(event) => {
                    set({ targetEntryId: event.target.value || undefined });
                  }}
                >
                  <option value="">{t('record.specificNone')}</option>
                  {account.openCharges.map((charge) => (
                    <option key={charge.entryId} value={charge.entryId}>
                      {chargeLabel(charge)} ·{' '}
                      {formatMoney(
                        { amount: charge.outstanding, currency: account.currency },
                        locale,
                      )}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="m-0 mt-1.5 text-[12px] text-ink-muted">{t('record.specificHint')}</p>
          </details>
        )}

        <div className="rounded-[9px] border border-border bg-sunken px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="block text-[12.5px] font-medium">{t('record.remaining')}</span>
              {status.remaining !== null && (
                <span
                  className={cn(
                    'mt-0.5 block text-[12px]',
                    status.full ? 'text-success' : 'text-warning',
                  )}
                >
                  {status.full ? t('record.caseFull') : t('record.casePartial')}
                </span>
              )}
            </div>
            <span
              dir="ltr"
              className={cn(
                FIGURE,
                'text-[17px] font-bold',
                status.remaining === null
                  ? 'text-ink-muted'
                  : status.remaining > 0n
                    ? 'text-danger'
                    : 'text-success',
              )}
            >
              {status.remaining === null ? '—' : money(status.remaining)}
            </span>
          </div>
          {preview.data && request && preview.data.allocations.length > 0 && (
            <ul
              aria-label={t('record.allocation')}
              className="m-0 mt-2.5 list-none border-t border-border p-0 pt-2"
            >
              {preview.data.allocations.map((line) => (
                <li
                  key={line.entryId}
                  className="flex justify-between gap-3 py-0.5 text-[12px] text-ink-secondary"
                >
                  <span>{chargeLabel(line)}</span>
                  <span dir="ltr" className={FIGURE}>
                    {formatMoney({ amount: line.amount, currency: account.currency }, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2.5 border-t border-inner-divider bg-sunken px-[22px] py-3.5">
        <Dialog.Close asChild>
          <Button variant="secondary" disabled={saving}>
            {t('common:cancel')}
          </Button>
        </Dialog.Close>
        <Button variant="primary" disabled={!valid || saving} onClick={() => void submit()}>
          {saving
            ? t('record.recording')
            : status.full
              ? t('record.submitFull')
              : t('record.submit')}
        </Button>
      </div>
    </>
  );
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[30px] cursor-pointer rounded-[15px] border border-border-control bg-surface px-3 text-[12px] font-medium hover:border-primary hover:text-primary disabled:cursor-default disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function payerNameOf(account: PatientAccount, patientPays: string): string {
  return account.payer.contactId === null ? patientPays : account.payer.name;
}
