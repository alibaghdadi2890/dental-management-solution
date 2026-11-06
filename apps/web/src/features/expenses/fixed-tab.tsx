import type { ExpenseCategory, Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  Pill,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { formatMonth } from '@/features/compensation/months';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { fixedExpensesQuery } from './expenses-api';
import { useCategoryName } from './expense-words';
import { FixedExpensePanel } from './fixed-expense-panel';

type Tenant = NonNullable<Session['tenant']>;

const COLUMNS = 'minmax(160px,1.3fr) minmax(140px,1fr) 130px 140px 96px 80px';
const STATUS_TONES = { active: 'success', paused: 'warning', ended: 'neutral' } as const;

/** Fixed monthly expenses (A3): the templates, their usual amount, next month and status. */
export function FixedTab({
  tenant,
  session,
  categories,
  canManage,
}: {
  tenant: Tenant;
  session: Session;
  categories: readonly ExpenseCategory[];
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation('expenses');
  const nameOf = useCategoryName();
  const locale = i18n.resolvedLanguage ?? 'en';
  const list = useQuery(fixedExpensesQuery());
  const [open, setOpen] = useState<string | null>();
  const byId = new Map(categories.map((category) => [category.id, category]));

  return (
    <>
      {canManage && (
        <div className="mb-3 flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              setOpen(null);
            }}
          >
            {t('fixed.add')}
          </Button>
        </div>
      )}
      <TableCard minWidth={760}>
        <div role="table" aria-label={t('tabs.fixed')}>
          <TableHead
            columns={COLUMNS}
            labels={[
              t('fixed.columns.name'),
              t('fixed.columns.category'),
              <span key="amount" className="block text-end">
                {t('fixed.columns.amount')}
              </span>,
              t('fixed.columns.next'),
              t('fixed.columns.status'),
              <span key="waiting" className="block text-end">
                {t('fixed.columns.waiting')}
              </span>,
            ]}
          />
          {list.isPending ? (
            <SkeletonRows columns={COLUMNS} label={t('loading')} />
          ) : list.isError ? (
            <ErrorState
              title={t('errorTitle')}
              body={t('errorBody')}
              requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
              error={list.error}
              onRetry={() => void list.refetch()}
            />
          ) : list.data.length === 0 ? (
            <EmptyState title={t('fixed.emptyTitle')} body={t('fixed.emptyBody')} />
          ) : (
            list.data.map((row) => (
              <button
                key={row.id}
                type="button"
                role="row"
                onClick={() => {
                  setOpen(row.id);
                }}
                className="grid min-h-12 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-row-divider bg-transparent px-3 text-start text-[13px] text-ink hover:bg-faint"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span role="cell" className="truncate font-medium">
                  {row.name}
                </span>
                <span role="cell" className="truncate">
                  {nameOf(byId.get(row.categoryId))}
                </span>
                <span role="cell" dir="ltr" className="block text-end font-mono tabular-nums">
                  {formatMoney({ amount: row.amount, currency: row.currency }, locale)}
                </span>
                <span role="cell">
                  {row.status === 'ended' ? '—' : formatMonth(row.nextMonth, locale)}
                </span>
                <span role="cell">
                  <Pill tone={STATUS_TONES[row.status]}>{t(`fixed.status.${row.status}`)}</Pill>
                </span>
                <span role="cell" className="block text-end font-mono tabular-nums">
                  {row.pendingCount > 0 ? row.pendingCount : '—'}
                </span>
              </button>
            ))
          )}
        </div>
      </TableCard>
      {open !== undefined && (
        <FixedExpensePanel
          fixedId={open}
          tenant={tenant}
          session={session}
          categories={categories}
          canManage={canManage}
          onClose={() => {
            setOpen(undefined);
          }}
        />
      )}
    </>
  );
}
