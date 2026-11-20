import type { Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoardIcon } from '@/components/board/board-icons';
import { CARD_ACTION, CARD_LINK, useRowArrival } from '@/components/board/board-kit';
import { TodayCard } from '@/components/board/today-card';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ExpensePanel } from './expense-panel';
import { categoriesQuery, expenseDashboardQuery } from './expenses-api';
import { useCategoryName } from './expense-words';
import { PendingList } from './pending-list';

/** How often the board asks again: expenses are recorded from other screens and computers too. */
const TODAY_REFETCH_MS = 60_000;

type Recent = { id: string; spentOn: string; label: string; detail: string | null; amount: string };

function RecentRow({ expense, currency }: { expense: Recent; currency: string }) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const arrival = useRowArrival();
  return (
    <li
      className={cn(
        'flex min-h-10 items-center gap-3 border-t border-row-divider px-3.5 text-[13px]',
        arrival,
      )}
    >
      <span className="w-[100px] flex-none text-ink-muted">
        {formatCalendarDate(expense.spentOn, locale)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {expense.label}
        {expense.detail && <span className="ms-2 text-ink-muted">{expense.detail}</span>}
      </span>
      <span dir="ltr" className="font-mono tabular-nums">
        {formatMoney({ amount: expense.amount, currency }, locale)}
      </span>
    </li>
  );
}

/**
 * This month's expenses on the Today board (A5, `expense:read`): the month's total and count,
 * the latest expenses, and the months waiting for confirmation; absent while the month has none
 * and nothing waits. Whoever manages expenses records one from the header. Never a salary, a
 * dentist payout or a payroll line, whoever looks (P9): the API leaves them out of this read.
 */
export function TodayExpensesCard({ session }: { session: Session }) {
  const { t, i18n } = useTranslation('expenses');
  const nameOf = useCategoryName();
  const locale = i18n.resolvedLanguage ?? 'en';
  const waitingId = useId();
  const canManage = usePermission('expense:manage');
  const dashboard = useQuery({
    ...expenseDashboardQuery(),
    refetchInterval: TODAY_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
  const categories = useQuery(categoriesQuery());
  const [recording, setRecording] = useState(false);
  const tenant = session.tenant;
  if (!tenant || dashboard.isPending) return null;
  const data = dashboard.data;
  if (data && data.total.count === 0 && data.pending.length === 0) return null;
  const byId = new Map((categories.data ?? []).map((category) => [category.id, category]));

  const card = (
    <TodayCard
      id="expenses"
      hue="orange"
      icon={<BoardIcon name="expenses" />}
      title={t('card.title')}
      regionLabel={t('card.title')}
      link={(label) => (
        <Link to="/expenses" className={CARD_LINK}>
          {label}
        </Link>
      )}
      action={
        canManage ? (
          <button
            type="button"
            className={CARD_ACTION}
            onClick={() => {
              setRecording(true);
            }}
          >
            {t('record')}
          </button>
        ) : null
      }
      span={6}
    >
      {data ? (
        <>
          <div className="flex items-baseline gap-3 px-3.5 pt-3.5 pb-3">
            <span
              dir="ltr"
              className="font-mono text-[22px] font-bold text-(--hue-ink) tabular-nums"
            >
              {formatMoney({ amount: data.total.amount, currency: tenant.currency }, locale)}
            </span>
            <span className="text-[12.5px] text-ink-muted">
              {t('card.count', { count: data.total.count })}
            </span>
          </div>
          {data.recent.length > 0 && (
            <ul className="m-0 list-none p-0">
              {data.recent.map((expense) => (
                <RecentRow
                  key={expense.id}
                  currency={expense.currency}
                  expense={{
                    id: expense.id,
                    spentOn: expense.spentOn,
                    label: nameOf(byId.get(expense.categoryId)),
                    detail: expense.payee ?? expense.description,
                    amount: expense.amount,
                  }}
                />
              ))}
            </ul>
          )}
          {data.pending.length > 0 && (
            <>
              <h4
                id={waitingId}
                className="m-0 border-t border-border bg-faint px-3.5 py-2.5 text-[12px] font-semibold"
              >
                {t('pending.title')} · {data.pending.length}
              </h4>
              <div aria-labelledby={waitingId}>
                <PendingList
                  items={data.pending}
                  tenant={tenant}
                  session={session}
                  categories={categories.data ?? []}
                  canManage={canManage}
                />
              </div>
            </>
          )}
        </>
      ) : (
        <p role="alert" className="m-0 px-3.5 py-5 text-[12.5px] text-ink-muted">
          {t('card.failed')}
        </p>
      )}
    </TodayCard>
  );

  return (
    <>
      {card}
      {/* Outside the card: a fixed overlay, and collapsing the card must not close it. */}
      {recording && (
        <ExpensePanel
          mode={{ kind: 'record' }}
          tenant={tenant}
          categories={categories.data ?? []}
          branches={session.branches}
          onClose={() => {
            setRecording(false);
          }}
        />
      )}
    </>
  );
}
