import type {
  ExpenseCategory,
  FixedExpenseDetail,
  FixedItem,
  PaymentMethod,
  Session,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Eyebrow, Field, Select, TextInput } from '@/components/ui/field';
import { Pill } from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { MoneyInput } from '@/features/billing/money-input';
import { formatMonth, monthOf, shiftMonth } from '@/features/compensation/months';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney, todayIn } from '@/lib/format';
import { ExpensePanel } from './expense-panel';
import {
  changeFixedExpense,
  createFixedExpense,
  fixedExpenseQuery,
  invalidateExpenses,
  skipItem,
  unskipItem,
  updateFixedExpense,
} from './expenses-api';
import { type ExpenseProblem, selectableCategories, useCategoryName } from './expense-words';
import { MethodPicker } from './method-picker';

type Tenant = NonNullable<Session['tenant']>;

const ITEM_TONES = { pending: 'warning', confirmed: 'success', skipped: 'neutral' } as const;

/**
 * Add or edit a fixed expense (A3), and see its months: waiting ones with Confirm and Skip,
 * skipped ones with Undo skip. An edit applies to months generated after it. Pause, Resume and End
 * sit in the footer. The first month may be earlier than this one, to enter the history.
 */
export function FixedExpensePanel({
  fixedId,
  tenant,
  session,
  categories,
  canManage,
  onClose,
}: {
  /** Null to add one. */
  fixedId: string | null;
  tenant: Tenant;
  session: Session;
  categories: readonly ExpenseCategory[];
  canManage: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['expenses', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const detail = useQuery({ ...fixedExpenseQuery(fixedId ?? ''), enabled: fixedId !== null });
  const currentMonth = monthOf(todayIn(tenant.timeZone));
  const loaded = detail.data;
  if (fixedId !== null && !loaded) return null;
  return (
    <Form
      key={loaded?.id ?? 'new'}
      detail={loaded}
      tenant={tenant}
      session={session}
      categories={categories}
      canManage={canManage}
      currentMonth={currentMonth}
      locale={locale}
      onClose={onClose}
      onDone={async (message) => {
        await invalidateExpenses(queryClient);
        toast(message, { tone: 'success' });
      }}
      confirmEnd={(name, action) => {
        confirm({
          title: t('expenses:fixed.endTitle', { name }),
          body: t('expenses:fixed.endBody'),
          okLabel: t('expenses:fixed.endOk'),
          tone: 'danger',
          onConfirm: action,
        });
      }}
      confirmSkip={(item, action) => {
        confirm({
          title: t('expenses:pending.skipTitle', {
            name: item.name,
            month: formatMonth(item.month, locale),
          }),
          body: t('expenses:pending.skipBody'),
          okLabel: t('expenses:pending.skipOk'),
          reasonLabel: t('expenses:pending.skipReason'),
          reasonOptional: true,
          onConfirm: action,
        });
      }}
      onError={(failure) => apiErrorMessage(failure, i18n)}
    />
  );
}

function Form({
  detail,
  tenant,
  session,
  categories,
  canManage,
  currentMonth,
  locale,
  onClose,
  onDone,
  confirmEnd,
  confirmSkip,
  onError,
}: {
  detail: FixedExpenseDetail | undefined;
  tenant: Tenant;
  session: Session;
  categories: readonly ExpenseCategory[];
  canManage: boolean;
  currentMonth: string;
  locale: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  confirmEnd: (name: string, action: () => Promise<void>) => void;
  confirmSkip: (item: FixedItem, action: (reason: string) => Promise<void>) => void;
  onError: (failure: unknown) => string;
}) {
  const { t } = useTranslation(['expenses', 'common']);
  const nameOf = useCategoryName();
  const editable = canManage && detail?.status !== 'ended';
  const [name, setName] = useState(detail?.name ?? '');
  const [categoryId, setCategoryId] = useState(detail?.categoryId ?? '');
  const [amountText, setAmountText] = useState(detail?.amount ?? '');
  const [method, setMethod] = useState<PaymentMethod | null>(detail?.method ?? null);
  const [payee, setPayee] = useState(detail?.payee ?? '');
  const [branchId, setBranchId] = useState(detail?.branchId ?? '');
  const [note, setNote] = useState(detail?.note ?? '');
  const [firstMonth, setFirstMonth] = useState(detail?.firstMonth ?? currentMonth);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<FixedItem>();
  const touch = () => {
    setDirty(true);
    setError(undefined);
  };
  const offered = [
    ...selectableCategories(categories),
    ...categories.filter(
      (category) =>
        category.id === detail?.categoryId && !(category.active && category.kind !== 'reserved'),
    ),
  ];
  const amount = parseAmount(amountText, locale);
  const problems: Record<string, ExpenseProblem | undefined> = {
    name: name.trim() === '' ? 'required' : undefined,
    category: categoryId === '' ? 'required' : undefined,
    amount:
      amount === '' ? 'required' : amount === null || Number(amount) <= 0 ? 'amount' : undefined,
  };
  const problem = (key: ExpenseProblem | undefined) =>
    tried && key !== undefined ? t(`expenses:panel.problems.${key}`) : undefined;

  const act = async (work: () => Promise<unknown>, message: string) => {
    setSaving(true);
    setError(undefined);
    try {
      await work();
      await onDone(message);
      return true;
    } catch (failure) {
      setError(onError(failure));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setTried(true);
    if (Object.values(problems).some(Boolean) || amount === null || amount === '') return;
    const text = (value: string) => (value.trim() === '' ? null : value.trim());
    const fields = {
      name: name.trim(),
      categoryId,
      amount,
      method,
      payee: text(payee),
      branchId: branchId === '' ? null : branchId,
      note: text(note),
    };
    const saved = await act(
      () =>
        detail
          ? updateFixedExpense(detail.id, fields)
          : createFixedExpense({ ...fields, firstMonth }),
      detail ? t('expenses:fixed.updated') : t('expenses:fixed.created'),
    );
    if (saved) {
      setDirty(false);
      if (!detail) onClose();
    }
  };

  const change = (kind: 'pause' | 'resume' | 'end') => {
    if (!detail) return;
    const run = () =>
      act(
        () => changeFixedExpense(detail.id, kind),
        kind === 'pause'
          ? t('expenses:fixed.paused')
          : kind === 'resume'
            ? t('expenses:fixed.resumed')
            : t('expenses:fixed.ended'),
      ).then(() => undefined);
    if (kind === 'end') confirmEnd(detail.name, run);
    else void run();
  };

  const months: string[] = [];
  for (
    let month = shiftMonth(currentMonth, -24);
    month <= currentMonth;
    month = shiftMonth(month, 1)
  ) {
    months.push(month);
  }

  return (
    <>
      <div
        aria-hidden
        onClick={saving ? undefined : onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('expenses:tabs.fixed')}
        title={detail ? detail.name : t('expenses:fixed.createTitle')}
        dirty={dirty}
        onClose={onClose}
        closeDisabled={saving}
        initialFocus={detail ? 'heading' : 'field'}
        className="fixed inset-y-0 end-0 z-40 w-[520px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          canManage ? (
            <>
              {detail?.status === 'active' && (
                <Button
                  disabled={saving}
                  onClick={() => {
                    change('pause');
                  }}
                >
                  {t('expenses:fixed.pause')}
                </Button>
              )}
              {detail?.status === 'paused' && (
                <Button
                  disabled={saving}
                  onClick={() => {
                    change('resume');
                  }}
                >
                  {t('expenses:fixed.resume')}
                </Button>
              )}
              {detail && detail.status !== 'ended' && (
                <Button
                  variant="danger"
                  disabled={saving}
                  onClick={() => {
                    change('end');
                  }}
                >
                  {t('expenses:fixed.end')}
                </Button>
              )}
              {editable && (
                <Button
                  variant="primary"
                  busy={saving}
                  className="ms-auto"
                  onClick={() => void save()}
                >
                  {detail ? t('expenses:fixed.saveEdit') : t('expenses:fixed.save')}
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4">
          {detail && (
            <div className="flex items-center gap-2">
              <Pill tone={detail.status === 'active' ? 'success' : 'neutral'}>
                {t(`expenses:fixed.status.${detail.status}`)}
              </Pill>
              {editable && (
                <span className="text-[12px] text-ink-muted">{t('expenses:fixed.editHint')}</span>
              )}
            </div>
          )}
          <fieldset disabled={!editable} className="m-0 flex flex-col gap-4 border-0 p-0">
            <Field label={t('expenses:fixed.name')} error={problem(problems.name)}>
              {(props) => (
                <TextInput
                  {...props}
                  value={name}
                  maxLength={120}
                  onChange={(event) => {
                    setName(event.target.value);
                    touch();
                  }}
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
            <Field label={t('expenses:fixed.amount')} error={problem(problems.amount)}>
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
                />
              )}
            </Field>
            <MethodPicker
              label={`${t('expenses:fixed.method')} · ${t('expenses:fixed.noMethod')}`}
              value={method}
              onChange={(value) => {
                setMethod(value);
                touch();
              }}
            />
            <Field label={t('expenses:panel.payee')} hint={t('expenses:panel.optional')}>
              {(props) => (
                <TextInput
                  {...props}
                  value={payee}
                  maxLength={120}
                  onChange={(event) => {
                    setPayee(event.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
            {session.branches.length > 1 && (
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
                    {session.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {!detail && (
              <Field
                label={t('expenses:fixed.firstMonth')}
                hint={t('expenses:fixed.firstMonthHint')}
              >
                {(props) => (
                  <Select
                    {...props}
                    value={firstMonth}
                    onChange={(event) => {
                      setFirstMonth(event.target.value);
                      touch();
                    }}
                  >
                    {[...months].reverse().map((month) => (
                      <option key={month} value={month}>
                        {formatMonth(month, locale)}
                      </option>
                    ))}
                    <option value={shiftMonth(currentMonth, 1)}>
                      {formatMonth(shiftMonth(currentMonth, 1), locale)}
                    </option>
                  </Select>
                )}
              </Field>
            )}
            <Field label={t('expenses:fixed.note')} hint={t('expenses:panel.optional')}>
              {(props) => (
                <TextInput
                  {...props}
                  value={note}
                  maxLength={500}
                  onChange={(event) => {
                    setNote(event.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
          </fieldset>
          {error && (
            <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
              {error}
            </p>
          )}
          {detail && (
            <section>
              <Eyebrow className="mb-2">{t('expenses:fixed.months')}</Eyebrow>
              {detail.items.length === 0 ? (
                <p className="m-0 text-[12.5px] text-ink-muted">
                  {t('expenses:fixed.noMonths', { month: formatMonth(detail.nextMonth, locale) })}
                </p>
              ) : (
                <ul className="m-0 list-none overflow-hidden rounded-lg border border-border p-0">
                  {detail.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex min-h-11 items-center gap-2.5 border-t border-row-divider px-3 first:border-t-0"
                    >
                      <span className="w-[120px] flex-none text-[13px] font-medium">
                        {formatMonth(item.month, locale)}
                      </span>
                      <Pill tone={ITEM_TONES[item.status]}>
                        {t(`expenses:fixed.itemStatus.${item.status}`)}
                      </Pill>
                      <span dir="ltr" className="ms-auto font-mono text-[13px] tabular-nums">
                        {formatMoney({ amount: item.amount, currency: item.currency }, locale)}
                      </span>
                      {canManage && item.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setConfirming(item);
                            }}
                          >
                            {t('expenses:pending.confirm')}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              confirmSkip(item, async (reason) => {
                                try {
                                  await skipItem(item.id, {
                                    reason: reason === '' ? null : reason,
                                  });
                                } catch (failure) {
                                  throw new Error(onError(failure), { cause: failure });
                                }
                                await onDone(t('expenses:pending.skipped'));
                              });
                            }}
                          >
                            {t('expenses:pending.skip')}
                          </Button>
                        </>
                      )}
                      {canManage && item.status === 'skipped' && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void act(() => unskipItem(item.id), t('expenses:pending.unskipped'))
                          }
                        >
                          {t('expenses:pending.unskip')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </RightPanel>
      {confirming && (
        <ExpensePanel
          mode={{ kind: 'confirm', item: confirming }}
          tenant={tenant}
          categories={categories}
          branches={session.branches}
          onClose={() => {
            setConfirming(undefined);
          }}
        />
      )}
    </>
  );
}
