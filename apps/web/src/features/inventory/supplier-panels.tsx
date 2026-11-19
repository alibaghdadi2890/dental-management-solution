import type { PaymentMethod, Session, Supplier, SupplierAdjustmentKind } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { Field, TextInput } from '@/components/ui/field';
import { InfoMark } from '@/components/ui/info-mark';
import { RightPanel } from '@/components/ui/right-panel';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { MoneyInput } from '@/features/billing/money-input';
import { Segmented } from '@/features/compensation/segmented';
import { MethodPicker } from '@/features/expenses/method-picker';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatMoney, todayIn } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import {
  createSupplier,
  invalidateInventory,
  recordSupplierAdjustment,
  recordSupplierPayment,
  setSupplierOpeningBalance,
  updateSupplier,
} from './inventory-api';
import { useInventoryWords } from './inventory-words';

type Tenant = NonNullable<Session['tenant']>;

function Overlay({ onClick }: { onClick: () => void }) {
  return (
    <div
      aria-hidden
      onClick={onClick}
      className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
    />
  );
}

const PANEL = 'fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]';

/** A supplier's details (Part D): add one, or edit it, with `inventory:manage`. */
export function SupplierFormPanel({
  supplier,
  onClose,
  onSaved,
}: {
  supplier?: Supplier;
  onClose: () => void;
  onSaved?: (supplier: Supplier) => void;
}) {
  const { t, i18n } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [values, setValues] = useState({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    note: supplier?.note ?? '',
  });
  const [active, setActive] = useState(supplier?.active ?? true);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (field: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };
  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    confirm({
      title: t('discardTitle'),
      body: t('discardBody'),
      okLabel: t('discardLeave'),
      tone: 'warn',
      onConfirm: onClose,
    });
  };
  const submit = async () => {
    setTried(true);
    if (values.name.trim() === '') return;
    setSaving(true);
    const blank = (text: string) => (text.trim() === '' ? null : text.trim());
    const body = {
      name: values.name.trim(),
      contactPerson: blank(values.contactPerson),
      phone: blank(values.phone),
      email: blank(values.email),
      address: blank(values.address),
      note: blank(values.note),
    };
    try {
      const saved = supplier
        ? await updateSupplier(supplier.id, { ...body, active })
        : await createSupplier(body);
      await invalidateInventory(queryClient);
      onSaved?.(saved);
      onClose();
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  const text = (field: keyof typeof values, label: string, max: number) => (
    <Field
      label={label}
      error={field === 'name' && tried && values.name.trim() === '' ? t('form.name') : undefined}
    >
      {(props) => (
        <TextInput
          {...props}
          value={values[field]}
          maxLength={max}
          onChange={(event) => {
            set(field)(event.target.value);
          }}
        />
      )}
    </Field>
  );
  return (
    <>
      <Overlay onClick={close} />
      <RightPanel
        modal
        title={supplier ? t('suppliers.edit') : t('suppliers.add')}
        dirty={dirty}
        onClose={close}
        closeDisabled={saving}
        initialFocus="field"
        className={PANEL}
        footer={
          <>
            <Button disabled={saving} onClick={close}>
              {t('cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void submit()}>
              {t('save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-[13px]">
          {text('name', t('suppliers.fields.name'), 80)}
          {text('contactPerson', t('suppliers.fields.contact'), 120)}
          {text('phone', t('suppliers.fields.phone'), 40)}
          {text('email', t('suppliers.fields.email'), 200)}
          {text('address', t('suppliers.fields.address'), 300)}
          {text('note', t('item.note'), 1000)}
          {supplier && (
            <label className="flex items-center gap-2">
              <Switch
                checked={active}
                onCheckedChange={(on) => {
                  setActive(on);
                  setDirty(true);
                }}
                label={t('suppliers.active')}
              />
              {t('suppliers.active')}
            </label>
          )}
        </div>
      </RightPanel>
    </>
  );
}

export type SupplierMoneyKind = 'payment' | 'adjustment' | 'opening';

/**
 * A supplier account's forms (Part D), with `inventory:money_manage`: a payment (mirrored into
 * Expenses), an adjustment (a credit or a charge, with a reason), the opening balance.
 */
export function SupplierMoneyPanel({
  kind,
  supplier,
  outstanding,
  tenant,
  onClose,
}: {
  kind: SupplierMoneyKind;
  supplier: Supplier;
  outstanding: string | undefined;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t, i18n, locale } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const keyFor = useIdempotencyKeys();
  const today = todayIn(tenant.timeZone);
  const [date, setDate] = useState(
    kind === 'opening' ? (supplier.openingBalanceOn ?? today) : today,
  );
  const [amountText, setAmountText] = useState(
    kind === 'opening' ? (supplier.openingBalance ?? '') : '',
  );
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [adjustment, setAdjustment] = useState<SupplierAdjustmentKind>('credit');
  const [reference, setReference] = useState('');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const amount = parseAmount(amountText, locale);
  const owing = outstanding !== undefined && Number(outstanding) > 0 ? outstanding : undefined;
  const problems = {
    amount:
      amount === null ||
      amount === '' ||
      (kind !== 'opening' && (amount.startsWith('-') || Number(amount) === 0))
        ? t('form.amount')
        : undefined,
    date: date === '' || date > today ? t('form.date') : undefined,
    method: kind === 'payment' && method === null ? t('form.method') : undefined,
    reason: kind === 'adjustment' && text.trim().length < 3 ? t('form.reason') : undefined,
  };
  const ready = Object.values(problems).every((problem) => problem === undefined);
  const shown = (field: keyof typeof problems) => (tried ? problems[field] : undefined);
  const submit = async () => {
    setTried(true);
    if (!ready || amount === null || amount === '') return;
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
        await recordSupplierPayment(supplier.id, body, keyFor(body));
      } else if (kind === 'adjustment') {
        const body = { onDate: date, kind: adjustment, amount, reason: text.trim() };
        await recordSupplierAdjustment(supplier.id, body, keyFor(body));
      } else {
        await setSupplierOpeningBalance(supplier.id, { amount, asOf: date });
      }
      await invalidateInventory(queryClient);
      toast(t(`money.${kind}.saved`), { tone: 'success' });
      onClose();
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Overlay onClick={onClose} />
      <RightPanel
        modal
        eyebrow={supplier.name}
        title={t(`money.${kind}.title`)}
        dirty={amountText !== ''}
        onClose={onClose}
        closeDisabled={saving}
        initialFocus="field"
        className={PANEL}
        footer={
          <>
            <Button disabled={saving} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void submit()}>
              {t(`money.${kind}.save`)}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-[13px]">
          {kind === 'adjustment' && (
            <span className="flex items-center gap-2">
              <Segmented
                label={t('money.adjustment.kind')}
                value={adjustment}
                options={[
                  { value: 'credit', label: t('money.adjustment.credit') },
                  { value: 'charge', label: t('money.adjustment.charge') },
                ]}
                onChange={setAdjustment}
              />
              <InfoMark about={t('money.adjustment.kind')}>{t('info.adjustment')}</InfoMark>
            </span>
          )}
          <Field
            label={t(`money.${kind}.amount`)}
            info={
              <>
                {kind === 'opening' && (
                  <InfoMark about={t('money.opening.amount')}>{t('info.opening')}</InfoMark>
                )}
                {kind === 'payment' && (
                  <InfoMark about={t('money.payment.amount')}>{t('info.payment')}</InfoMark>
                )}
              </>
            }
            error={shown('amount')}
          >
            {(props) => (
              <MoneyInput
                {...props}
                value={amountText}
                onChange={setAmountText}
                currency={tenant.currency}
                locale={locale}
                className="h-11 text-[18px] font-semibold"
              />
            )}
          </Field>
          {kind === 'payment' && owing !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              className="-mt-2 self-start"
              onClick={() => {
                setAmountText(owing);
              }}
            >
              {t('money.payment.payAll', {
                amount: formatMoney({ amount: owing, currency: tenant.currency }, locale),
              })}
            </Button>
          )}
          <Field label={t(`money.${kind}.date`)} error={shown('date')}>
            {(props) => (
              <DateInput
                {...props}
                value={date}
                onChange={setDate}
                order={dateInputOrder(tenant.country)}
                today={today}
                pickerLabel={t(`money.${kind}.date`)}
              />
            )}
          </Field>
          {kind === 'payment' && (
            <div>
              <MethodPicker label={t('receipt.method')} value={method} onChange={setMethod} />
              {shown('method') && (
                <span className="mt-[5px] block text-xs font-medium text-danger">
                  {shown('method')}
                </span>
              )}
            </div>
          )}
          {kind === 'payment' && (
            <Field label={t('receipt.reference')}>
              {(props) => (
                <TextInput
                  {...props}
                  value={reference}
                  maxLength={100}
                  onChange={(event) => {
                    setReference(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
          {kind !== 'opening' && (
            <Field
              label={kind === 'payment' ? t('item.note') : t('history.reason')}
              error={shown('reason')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  value={text}
                  maxLength={500}
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
        </div>
      </RightPanel>
    </>
  );
}
