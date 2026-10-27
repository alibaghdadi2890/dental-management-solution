import {
  ADJUSTMENT_KINDS,
  type AdjustmentKind,
  PAYMENT_METHODS,
  type PaymentMethod,
  type Session,
} from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { MoneyInput } from '@/features/billing/money-input';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, todayIn } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { cn } from '@/lib/utils';
import { invalidateCompensation, recordAdjustment, recordPayout } from './compensation-api';
import { lastDayOf } from './months';
import { Segmented } from './segmented';

type Tenant = NonNullable<Session['tenant']>;
export type MoneyRowKind = 'adjustment' | 'payout';

const NOTE_MAX = 500;
const REFERENCE_MAX = 80;

/**
 * Add adjustment / Record payout (prompt §2): a right panel over the statement. An adjustment is
 * dated, signed by its direction (adds to what the clinic owes the dentist, or deducts) and has a
 * kind; a payout is dated, positive, with a method, a reference and a note. The date defaults to
 * today within the statement's month, or its last day for an earlier month.
 */
export function MoneyRowPanel({
  kind,
  profileId,
  month,
  tenant,
  onClose,
}: {
  kind: MoneyRowKind;
  profileId: string;
  month: string;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['compensation', 'billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const methodsId = useId();
  const today = todayIn(tenant.timeZone);
  const [date, setDate] = useState(today.startsWith(month) ? today : lastDayOf(month));
  const [amountText, setAmountText] = useState('');
  const [direction, setDirection] = useState<'add' | 'deduct'>('add');
  const [adjustmentKind, setAdjustmentKind] = useState<AdjustmentKind | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const touch = () => {
    setDirty(true);
    setError(undefined);
  };
  const amount = parseAmount(amountText, locale);
  const amountProblem =
    amount === '' ? 'required' : amount === null || Number(amount) === 0 ? 'amount' : undefined;
  const kindProblem = kind === 'adjustment' && adjustmentKind === '' ? 'required' : undefined;
  const noteProblem =
    kind === 'adjustment' && adjustmentKind === 'other' && note.trim() === '' ? 'note' : undefined;
  const ready = !amountProblem && !kindProblem && !noteProblem;

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
    if (!ready || amount === null || amount === '' || saving) return;
    setSaving(true);
    try {
      const trimmedNote = note.trim() === '' ? null : note.trim();
      if (kind === 'adjustment') {
        const request = {
          kind: adjustmentKind === '' ? 'other' : adjustmentKind,
          amount: direction === 'deduct' ? `-${amount}` : amount,
          date,
          note: trimmedNote,
        } as const;
        await recordAdjustment(profileId, request, keyFor(request));
      } else {
        const request = {
          amount,
          date,
          method,
          reference: reference.trim() === '' ? null : reference.trim(),
          note: trimmedNote,
        };
        await recordPayout(profileId, request, keyFor(request));
      }
      await invalidateCompensation(queryClient);
      toast(t(`compensation:panel.${kind}.saved`), { tone: 'success' });
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
    } finally {
      setSaving(false);
    }
  };

  const problem = (key: 'required' | 'amount' | 'note' | undefined) =>
    tried && key !== undefined ? t(`compensation:panel.problems.${key}`) : undefined;

  return (
    <>
      <div
        aria-hidden
        onClick={close}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('compensation:panel.eyebrow')}
        title={t(`compensation:panel.${kind}.title`)}
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
              {t(`compensation:panel.${kind}.submit`)}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t('compensation:panel.date')}>
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
                pickerLabel={t('compensation:form.chooseDate')}
              />
            )}
          </Field>
          {kind === 'adjustment' && (
            <Segmented
              label={t('compensation:panel.adjustment.direction')}
              value={direction}
              options={[
                { value: 'add', label: t('compensation:panel.adjustment.add') },
                { value: 'deduct', label: t('compensation:panel.adjustment.deduct') },
              ]}
              onChange={(value) => {
                setDirection(value);
                touch();
              }}
            />
          )}
          <Field label={t('compensation:panel.amount')} error={problem(amountProblem)}>
            {(props) => (
              <MoneyInput
                {...props}
                value={amountText}
                onChange={(text) => {
                  setAmountText(text);
                  touch();
                }}
                currency={tenant.currency}
                locale={locale}
                className="h-11 text-[18px] font-semibold"
              />
            )}
          </Field>
          {kind === 'adjustment' ? (
            <Field label={t('compensation:panel.adjustment.kind')} error={problem(kindProblem)}>
              {(props) => (
                <Select
                  {...props}
                  value={adjustmentKind}
                  onChange={(event) => {
                    setAdjustmentKind(
                      ADJUSTMENT_KINDS.find((value) => value === event.target.value) ?? '',
                    );
                    touch();
                  }}
                >
                  <option value="" disabled>
                    {t('compensation:panel.adjustment.chooseKind')}
                  </option>
                  {ADJUSTMENT_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {t(`compensation:adjustmentKinds.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <>
              <div>
                <div id={methodsId} className="mb-1.5 text-[12.5px] leading-none font-medium">
                  {t('compensation:panel.payout.method')}
                </div>
                <div
                  role="radiogroup"
                  aria-labelledby={methodsId}
                  className="flex flex-wrap gap-1.5"
                >
                  {PAYMENT_METHODS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={method === value}
                      onClick={() => {
                        setMethod(value);
                        touch();
                      }}
                      className={cn(
                        'h-[30px] cursor-pointer rounded-[15px] border px-3 text-[12px] font-medium',
                        method === value
                          ? 'border-primary bg-primary-tint text-primary'
                          : 'border-border-control bg-surface hover:border-ink',
                      )}
                    >
                      {t(`billing:methods.${value}`)}
                    </button>
                  ))}
                </div>
              </div>
              <Field
                label={t('compensation:panel.payout.reference')}
                hint={t('compensation:form.optional')}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    value={reference}
                    maxLength={REFERENCE_MAX}
                    onChange={(event) => {
                      setReference(event.target.value);
                      touch();
                    }}
                  />
                )}
              </Field>
            </>
          )}
          <Field
            label={t('compensation:panel.note')}
            hint={adjustmentKind === 'other' ? undefined : t('compensation:form.optional')}
            error={problem(noteProblem)}
          >
            {(props) => (
              <TextInput
                {...props}
                value={note}
                maxLength={NOTE_MAX}
                onChange={(event) => {
                  setNote(event.target.value);
                  touch();
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
