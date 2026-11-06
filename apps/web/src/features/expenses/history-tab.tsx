import {
  type Expense,
  type ExpenseCategory,
  exportLanguageSchema,
  isEditableExpense,
  PAYMENT_METHODS,
  type Session,
} from '@dcm/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  Pill,
  SearchInput,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { MonthPicker } from '@/features/compensation/month-picker';
import { formatMonth } from '@/features/compensation/months';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatCalendarDate, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ExpensePanel } from './expense-panel';
import {
  downloadExpenses,
  expensesQuery,
  invalidateExpenses,
  pendingItemsQuery,
  voidExpense,
} from './expenses-api';
import { type ExpensesSearch, filterOf } from './expenses-search';
import { useCategoryName } from './expense-words';
import { PendingList } from './pending-list';

type Tenant = NonNullable<Session['tenant']>;

const COLUMNS =
  '104px minmax(150px,1.1fr) minmax(120px,1fr) minmax(140px,1.3fr) 110px 110px 120px 96px 132px';
const FIGURE = 'block text-end font-mono tabular-nums';

/**
 * The expense history (A4): the filter in the URL, the months waiting above it, a summary by
 * category (a chip filters on it), every row with its status — a voided one struck through, a
 * salary or a payout labelled and read-only — and the total of what the filter holds, voided rows
 * never counted. Export takes the same filter.
 */
export function HistoryTab({
  search,
  onSearch,
  session,
  tenant,
  categories,
  currentMonth,
  canManage,
  onRecord,
}: {
  search: ExpensesSearch;
  onSearch: (patch: Partial<ExpensesSearch>) => void;
  session: Session;
  tenant: Tenant;
  categories: readonly ExpenseCategory[];
  currentMonth: string;
  canManage: boolean;
  onRecord: () => void;
}) {
  const { t, i18n } = useTranslation(['expenses', 'billing', 'common']);
  const nameOf = useCategoryName();
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const filter = filterOf(search, currentMonth);
  const today = todayIn(tenant.timeZone);
  const list = useQuery({ ...expensesQuery(filter), placeholderData: keepPreviousData });
  const pending = useQuery(pendingItemsQuery());
  const [editing, setEditing] = useState<Expense>();
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState(search.from !== undefined);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const branches = new Map(session.branches.map((branch) => [branch.id, branch.name]));
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);

  const runExport = () => {
    setExporting(true);
    downloadExpenses(filter, exportLanguageSchema.safeParse(locale).data)
      .catch((error: unknown) => {
        toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      })
      .finally(() => {
        setExporting(false);
      });
  };

  const askVoid = (expense: Expense) => {
    confirm({
      title: t('expenses:void.title'),
      body: t('expenses:void.body'),
      okLabel: t('expenses:void.ok'),
      tone: 'danger',
      reasonLabel: t('expenses:void.reason'),
      onConfirm: async (reason) => {
        try {
          await voidExpense(expense.id, { reason });
        } catch (failure) {
          throw new Error(apiErrorMessage(failure, i18n), { cause: failure });
        }
        await invalidateExpenses(queryClient);
        toast(t('expenses:void.done'), { tone: 'success' });
      },
    });
  };

  const month = search.month ?? currentMonth;
  const categoryOptions = [
    { value: '', label: t('expenses:filters.allCategories') },
    ...categories.map((category) => ({ value: category.id, label: nameOf(category) })),
  ];

  return (
    <>
      {(pending.data?.length ?? 0) > 0 && (
        <section className="mb-4 overflow-hidden rounded-xl border border-warning-border bg-surface">
          <div className="border-b border-row-divider bg-warning-bg px-[18px] py-2.5">
            <h2 className="m-0 text-[13px] font-semibold text-warning">
              {t('expenses:pending.title')} · {pending.data?.length}
            </h2>
            <p className="m-0 mt-1 text-[12px] text-ink-secondary">{t('expenses:pending.body')}</p>
          </div>
          <PendingList
            items={pending.data ?? []}
            tenant={tenant}
            session={session}
            categories={categories}
            canManage={canManage}
          />
        </section>
      )}

      <div
        role="group"
        aria-label={t('expenses:filters.label')}
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        {range ? (
          <div className="flex items-center gap-2">
            <DateInput
              aria-label={t('expenses:filters.from')}
              value={filter.from}
              onChange={(from) => {
                onSearch({ from, to: filter.to, month: undefined });
              }}
              order={dateInputOrder(tenant.country)}
              today={today}
              pickerLabel={t('expenses:filters.chooseFrom')}
            />
            <span aria-hidden>–</span>
            <DateInput
              aria-label={t('expenses:filters.to')}
              value={filter.to}
              onChange={(to) => {
                onSearch({ from: filter.from, to, month: undefined });
              }}
              order={dateInputOrder(tenant.country)}
              today={today}
              pickerLabel={t('expenses:filters.chooseTo')}
            />
          </div>
        ) : (
          <MonthPicker
            month={month}
            latest={currentMonth}
            onChange={(next) => {
              onSearch({ month: next === currentMonth ? undefined : next });
            }}
          />
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRange(!range);
            if (range) onSearch({ from: undefined, to: undefined });
          }}
        >
          {range ? t('expenses:filters.month') : t('expenses:filters.range')}
        </Button>
        <FilterChip
          label={t('expenses:filters.category')}
          value={search.category ?? ''}
          options={categoryOptions}
          onChange={(value) => {
            onSearch({ category: value || undefined });
          }}
        />
        {session.branches.length > 1 && (
          <FilterChip
            label={t('expenses:filters.branch')}
            value={search.branch ?? ''}
            options={[
              { value: '', label: t('expenses:filters.allBranches') },
              ...session.branches.map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
            onChange={(value) => {
              onSearch({ branch: value || undefined });
            }}
          />
        )}
        <FilterChip
          label={t('expenses:filters.method')}
          value={search.method ?? ''}
          options={[
            { value: '', label: t('expenses:filters.allMethods') },
            ...PAYMENT_METHODS.map((value) => ({ value, label: t(`billing:methods.${value}`) })),
          ]}
          onChange={(value) => {
            onSearch({ method: PAYMENT_METHODS.find((method) => method === value) });
          }}
        />
        <SearchInput
          value={search.q ?? ''}
          onChange={(value) => {
            onSearch({ q: value === '' ? undefined : value });
          }}
          placeholder={t('expenses:filters.search')}
          label={t('expenses:filters.searchLabel')}
          maxLength={100}
        />
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <Switch
            checked={search.voided === true}
            onCheckedChange={(checked) => {
              onSearch({ voided: checked ? true : undefined });
            }}
            label={t('expenses:filters.showVoided')}
          />
          {t('expenses:filters.showVoided')}
        </label>
        <span className="ms-auto flex gap-2">
          <Button variant="outline" busy={exporting} onClick={runExport}>
            {t('expenses:export')}
          </Button>
          {canManage && (
            <Button variant="primary" onClick={onRecord}>
              {t('expenses:record')}
            </Button>
          )}
        </span>
      </div>

      {list.data && list.data.byCategory.length > 0 && (
        <div
          role="group"
          aria-label={t('expenses:byCategory')}
          title={t('expenses:byCategoryHint')}
          className="mb-3 flex flex-wrap gap-1.5"
        >
          {list.data.byCategory.map((row) => {
            const on = search.category === row.categoryId;
            return (
              <button
                key={row.categoryId}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onSearch({ category: on ? undefined : row.categoryId });
                }}
                className={cn(
                  'flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-[12.5px]',
                  on
                    ? 'border-primary bg-primary-tint text-primary'
                    : 'border-border bg-surface hover:border-ink',
                )}
              >
                <span className="font-medium">{nameOf(byId.get(row.categoryId))}</span>
                <span dir="ltr" className="font-mono tabular-nums text-ink-secondary">
                  {money(row.amount)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <TableCard
        minWidth={1100}
        footer={
          list.data && list.data.items.length > 0 ? (
            <div className="flex items-center justify-between gap-3 border-t border-border bg-faint px-3 py-2.5 text-[13px]">
              <span className="font-medium">
                {t('expenses:total', { count: list.data.total.count })}
                {list.data.nextCursor !== null && (
                  <span className="ms-2 font-normal text-ink-muted">
                    {t('expenses:allShown', { count: list.data.items.length })}
                  </span>
                )}
              </span>
              <span dir="ltr" className="font-mono font-semibold tabular-nums">
                {money(list.data.total.amount)}
              </span>
            </div>
          ) : undefined
        }
      >
        <div
          role="table"
          aria-label={t('expenses:tabs.history')}
          aria-busy={list.isPlaceholderData}
        >
          <TableHead
            columns={COLUMNS}
            labels={[
              t('expenses:columns.date'),
              t('expenses:columns.category'),
              t('expenses:columns.payee'),
              t('expenses:columns.description'),
              t('expenses:columns.branch'),
              t('expenses:columns.method'),
              <span key="amount" className="block text-end">
                {t('expenses:columns.amount')}
              </span>,
              t('expenses:columns.status'),
              <span key="actions" className="sr-only">
                {t('expenses:columns.actions')}
              </span>,
            ]}
          />
          {list.isPending ? (
            <SkeletonRows columns={COLUMNS} label={t('expenses:loading')} />
          ) : list.isError && !list.data ? (
            <ErrorState
              title={t('expenses:errorTitle')}
              body={t('expenses:errorBody')}
              requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
              error={list.error}
              onRetry={() => void list.refetch()}
            />
          ) : list.data.items.length === 0 ? (
            <EmptyState title={t('expenses:empty.title')} body={t('expenses:empty.body')} />
          ) : (
            list.data.items.map((expense) => {
              const voided = expense.voidedAt !== null;
              const mirrored = expense.source === 'payroll' || expense.source === 'compensation';
              return (
                <div
                  key={expense.id}
                  role="row"
                  className={cn(
                    'grid min-h-12 items-center gap-2.5 border-t border-row-divider px-3 text-[13px]',
                    voided && 'text-ink-muted',
                  )}
                  style={{ gridTemplateColumns: COLUMNS }}
                >
                  <span role="cell">{formatCalendarDate(expense.spentOn, locale)}</span>
                  <span role="cell" className={cn('truncate', voided && 'line-through')}>
                    {nameOf(byId.get(expense.categoryId))}
                    {expense.sourceMonth && (
                      <span className="ms-1.5 text-[12px] text-ink-muted">
                        {t('expenses:forMonth', {
                          month: formatMonth(expense.sourceMonth, locale),
                        })}
                      </span>
                    )}
                  </span>
                  <span role="cell" className="truncate">
                    {expense.payee ?? '—'}
                  </span>
                  <span
                    role="cell"
                    className="truncate"
                    title={voided ? (expense.voidReason ?? '') : undefined}
                  >
                    {voided ? expense.voidReason : (expense.description ?? '—')}
                  </span>
                  <span role="cell" className="truncate">
                    {expense.branchId
                      ? (branches.get(expense.branchId) ?? '—')
                      : t('expenses:clinicWide')}
                  </span>
                  <span role="cell">{t(`billing:methods.${expense.method}`)}</span>
                  <span role="cell" dir="ltr" className={cn(FIGURE, voided && 'line-through')}>
                    {money(expense.amount)}
                  </span>
                  <span role="cell">
                    {voided ? (
                      <Pill tone="neutral">{t('expenses:status.voided')}</Pill>
                    ) : mirrored ? (
                      <Pill tone="indigo">{t(`expenses:source.${expense.source}`)}</Pill>
                    ) : (
                      <Pill tone="success">{t('expenses:status.recorded')}</Pill>
                    )}
                  </span>
                  <span role="cell" className="flex justify-end gap-1.5">
                    {canManage && isEditableExpense(expense) && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditing(expense);
                          }}
                        >
                          {t('expenses:actions.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            askVoid(expense);
                          }}
                        >
                          {t('expenses:actions.void')}
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </TableCard>

      {editing && (
        <ExpensePanel
          mode={{ kind: 'edit', expense: editing }}
          tenant={tenant}
          categories={categories}
          branches={session.branches}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </>
  );
}
