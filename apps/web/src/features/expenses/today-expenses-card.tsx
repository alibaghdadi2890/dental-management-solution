import type { Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { categoriesQuery, expenseDashboardQuery } from './expenses-api';
import { useCategoryName } from './expense-words';
import { PendingList } from './pending-list';

/**
 * This month's expenses on the Today board (A5, `expense:read`): the month's total and count,
 * the latest expenses with *See all*, and the months waiting for confirmation. Never a salary,
 * a dentist payout or a payroll line, whoever looks (P9): the API leaves them out of this read.
 */
export function TodayExpensesCard({ session }: { session: Session }) {
  const { t, i18n } = useTranslation('expenses');
  const nameOf = useCategoryName();
  const locale = i18n.resolvedLanguage ?? 'en';
  const headingId = useId();
  const waitingId = useId();
  const canManage = usePermission('expense:manage');
  const dashboard = useQuery(expenseDashboardQuery());
  const categories = useQuery(categoriesQuery());
  const tenant = session.tenant;
  if (!tenant) return null;
  const byId = new Map((categories.data ?? []).map((category) => [category.id, category]));

  return (
    <section aria-labelledby={headingId} className="mb-6">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2
          id={headingId}
          className="m-0 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal"
        >
          {t('card.title')}
        </h2>
        <Link to="/expenses" className="text-[12.5px] font-medium text-primary hover:underline">
          {t('card.seeAll')}
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {dashboard.isPending ? (
          <div className="px-[18px] py-4">
            <CardSkeleton label={t('card.loading')} />
          </div>
        ) : dashboard.isError ? (
          <p role="alert" className="m-0 px-[18px] py-5 text-[12.5px] text-ink-muted">
            {t('card.failed')}
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-3 px-[18px] pt-4 pb-3">
              <span dir="ltr" className="font-mono text-[22px] font-semibold tabular-nums">
                {formatMoney(
                  { amount: dashboard.data.total.amount, currency: tenant.currency },
                  locale,
                )}
              </span>
              <span className="text-[12.5px] text-ink-muted">
                {t('card.count', { count: dashboard.data.total.count })}
              </span>
            </div>
            {dashboard.data.recent.length === 0 ? (
              <p className="m-0 border-t border-row-divider px-[18px] py-3 text-[12.5px] text-ink-muted">
                {t('card.empty')}
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {dashboard.data.recent.map((expense) => (
                  <li
                    key={expense.id}
                    className="flex min-h-10 items-center gap-3 border-t border-row-divider px-[18px] text-[13px]"
                  >
                    <span className="w-[110px] flex-none text-ink-muted">
                      {formatCalendarDate(expense.spentOn, locale)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {nameOf(byId.get(expense.categoryId))}
                      {(expense.payee ?? expense.description) && (
                        <span className="ms-2 text-ink-muted">
                          {expense.payee ?? expense.description}
                        </span>
                      )}
                    </span>
                    <span dir="ltr" className="font-mono tabular-nums">
                      {formatMoney({ amount: expense.amount, currency: expense.currency }, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <h3
              id={waitingId}
              className="m-0 border-t border-border bg-faint px-[18px] py-2.5 text-[12px] font-semibold"
            >
              {t('pending.title')} · {dashboard.data.pending.length}
            </h3>
            <div aria-labelledby={waitingId}>
              <PendingList
                items={dashboard.data.pending}
                tenant={tenant}
                session={session}
                categories={categories.data ?? []}
                canManage={canManage}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
