import {
  type Expense,
  type ExpenseCategory,
  type FixedItem,
  type PaymentMethod,
  type Session,
} from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { MoneyInput } from '@/features/billing/money-input';
import { formatMonth } from '@/features/compensation/months';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, todayIn } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { confirmItems, invalidateExpenses, recordExpense, updateExpense } from './expenses-api';
import { type ExpenseProblem, selectableCategories, useCategoryName } from './expense-words';
import { MethodPicker } from './method-picker';

type Tenant = NonNullable<Session['tenant']>;

/** What the panel does: a new expense, an edit, or the confirmation of one waiting month. */
export type ExpensePanelMode =
  { kind: 'record' } | { kind: 'edit'; expense: Expense } | { kind: 'confirm'; item: FixedItem };

const PAYEE_MAX = 120;
const REFERENCE_MAX = 80;
const DESCRIPTION_MAX = 300;

/**
 * Record expense, Edit and Confirm (A2, A3): one right panel. A confirmation is pre-filled from
 * the waiting month (amount, category, method, payee, branch, the name as its description) and
 * every field stays editable, the amount first of all. The date defaults to today and may not be
 * later; *Other* needs a description.
 */
export function ExpensePanel({
  mode,
  tenant,
  categories,
  branches,
  onClose,
}: {
  mode: ExpensePanelMode;
  tenant: Tenant;
  categories: readonly ExpenseCategory[];
  branches: Session['branches'];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['expenses', 'common']);
  const nameOf = useCategoryName();
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const today = todayIn(tenant.timeZone);
  const start =
    mode.kind === 'edit'
      ? mode.expense
      : mode.kind === 'confirm'
        ? { ...mode.item, description: mode.item.name, reference: null, spentOn: today }
        : undefined;
  const [date, setDate] = useState(start?.spentOn ?? today);
  const [categoryId, setCategoryId] = useState(start?.categoryId ?? '');
  const [amountText, setAmountText] = useState(start?.amount ?? '');
  const [method, setMethod] = useState<PaymentMethod | null>(start?.method ?? null);
  const [payee, setPayee] = useState(start?.payee ?? '');
  const [reference, setReference] = useState(start?.reference ?? '');
  const [description, setDescription] = useState(start?.description ?? '');
  const [branchId, setBranchId] = useState(start?.branchId ?? '');
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const touch = () => {
    setDirty(true);
    setError(undefined);
  };
  // The current category stays offered in an edit even once deactivated.
  const offered = [
    ...selectableCategories(categories),
    ...categories.filter(
      (category) =>
        category.id === start?.categoryId && !(category.active && category.kind !== 'reserved'),
    ),
  ];
  const chosen = categories.find((category) => category.id === categoryId);
  const amount = parseAmount(amountText, locale);
  const problems: Record<string, ExpenseProblem | undefined> = {
    date: date > today ? 'future' : undefined,
    category: categoryId === '' ? 'required' : undefined,
    amount:
      amount === '' ? 'required' : amount === null || Number(amount) <= 0 ? 'amount' : undefined,
    method: method === null ? 'required' : undefined,
    description: chosen?.kind === 'other' && description.trim() === '' ? 'description' : undefined,
  };
  const ready = Object.values(problems).every((problem) => problem === undefined);
  const problem = (key: ExpenseProblem | undefined) =>
    tried && key !== undefined ? t(`expenses:panel.problems.${key}`) : undefined;

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
    if (!ready || amount === null || amount === '' || method === null || saving) return;
    setSaving(true);
    const text = (value: string) => (value.trim() === '' ? null : value.trim());
    const request = {
      spentOn: date,
      categoryId,
      amount,
      method,
      payee: text(payee),
      reference: text(reference),
      description: text(description),
      branchId: branchId === '' ? null : branchId,
    };
    try {
      if (mode.kind === 'record') {
        await recordExpense(request, keyFor(request));
      } else if (mode.kind === 'edit') {
        await updateExpense(mode.expense.id, request);
      } else {
        const body = { items: [{ itemId: mode.item.id, ...request }] };
        await confirmItems(body, keyFor(body));
      }
      await invalidateExpenses(queryClient);
      toast(
        t(
          mode.kind === 'record'
            ? 'expenses:panel.saved'
            : mode.kind === 'edit'
              ? 'expenses:panel.updated'
              : 'expenses:panel.confirmed',
        ),
        { tone: 'success' },
      );
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode.kind === 'record'
      ? t('expenses:panel.recordTitle')
      : mode.kind === 'edit'
        ? t('expenses:panel.editTitle')
        : t('expenses:panel.confirmTitle', {
            name: mode.item.name,
            month: formatMonth(mode.item.month, locale),
          });

  return (
    <>
      <div
        aria-hidden
        onClick={close}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('expenses:panel.eyebrow')}
        title={title}
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
              {t(
                mode.kind === 'record'
                  ? 'expenses:panel.save'
                  : mode.kind === 'edit'
                    ? 'expenses:panel.saveEdit'
                    : 'expenses:panel.saveConfirm',
              )}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t('expenses:panel.amount')} error={problem(problems.amount)}>
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
          <Field label={t('expenses:panel.date')} error={problem(problems.date)}>
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
                pickerLabel={t('expenses:panel.chooseDate')}
              />
            )}
          </Field>
          <Field label={t('expenses:panel.category')} error={problem(problems.category)}>
            {(props) => (
              <Select
                {...props}
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  touch();
                }}
              >
                <option value="" disabled>
                  {t('expenses:panel.chooseCategory')}
                </option>
                {offered.map((category) => (
                  <option key={category.id} value={category.id}>
                    {nameOf(category)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div>
            <MethodPicker
              label={t('expenses:panel.method')}
              value={method}
              onChange={(value) => {
                setMethod(value);
                touch();
              }}
            />
            {problem(problems.method) && (
              <span className="mt-[5px] block text-xs font-medium text-danger">
                {problem(problems.method)}
              </span>
            )}
          </div>
          <Field label={t('expenses:panel.payee')} hint={t('expenses:panel.optional')}>
            {(props) => (
              <TextInput
                {...props}
                value={payee}
                maxLength={PAYEE_MAX}
                onChange={(event) => {
                  setPayee(event.target.value);
                  touch();
                }}
              />
            )}
          </Field>
          <Field
            label={t('expenses:panel.description')}
            hint={
              chosen?.kind === 'other'
                ? t('expenses:panel.requiredForOther')
                : t('expenses:panel.optional')
            }
            error={problem(problems.description)}
          >
            {(props) => (
              <TextInput
                {...props}
                value={description}
                maxLength={DESCRIPTION_MAX}
                onChange={(event) => {
                  setDescription(event.target.value);
                  touch();
                }}
              />
            )}
          </Field>
          <Field label={t('expenses:panel.reference')} hint={t('expenses:panel.referenceHint')}>
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
          {branches.length > 1 && (
            <Field label={t('expenses:panel.branch')} hint={t('expenses:panel.optional')}>
              {(props) => (
                <Select
                  {...props}
                  value={branchId}
                  onChange={(event) => {
                    setBranchId(event.target.value);
                    touch();
                  }}
                >
                  <option value="">{t('expenses:clinicWide')}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
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
