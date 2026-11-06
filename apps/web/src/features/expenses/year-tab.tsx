import type { Session } from '@dcm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/button';
import { ErrorState, SkeletonRows, TableCard, TableHead } from '@/components/ui/list';
import { formatMonth } from '@/features/compensation/months';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { expenseYearQuery } from './expenses-api';

type Tenant = NonNullable<Session['tenant']>;

const COLUMNS = 'minmax(160px,1fr) 120px 160px';
const FIGURE = 'block text-end font-mono tabular-nums';

/** Month by month for a year (A4); a month opens the History on it. */
export function YearTab({
  year,
  latestYear,
  tenant,
  onYear,
  onMonth,
}: {
  year: number;
  latestYear: number;
  tenant: Tenant;
  onYear: (year: number) => void;
  onMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation('expenses');
  const locale = i18n.resolvedLanguage ?? 'en';
  const result = useQuery({ ...expenseYearQuery(year), placeholderData: keepPreviousData });
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);

  return (
    <>
      <div className="mb-3 flex items-center gap-1">
        <IconButton
          aria-label={t('year.previous')}
          onClick={() => {
            onYear(year - 1);
          }}
          className="rtl:rotate-180"
        >
          <span aria-hidden>‹</span>
        </IconButton>
        <h2
          aria-live="polite"
          className="m-0 min-w-[132px] text-center text-[13.5px] font-semibold"
        >
          {t('year.title', { year })}
        </h2>
        <IconButton
          aria-label={t('year.next')}
          disabled={year >= latestYear}
          onClick={() => {
            onYear(year + 1);
          }}
          className="disabled:cursor-default disabled:opacity-40 rtl:rotate-180"
        >
          <span aria-hidden>›</span>
        </IconButton>
      </div>
      <TableCard
        minWidth={460}
        footer={
          result.data ? (
            <div
              className="grid items-center gap-2.5 border-t border-border bg-faint px-3 py-2.5 text-[13px] font-semibold"
              style={{ gridTemplateColumns: COLUMNS }}
            >
              <span>{t('year.total')}</span>
              <span className={FIGURE}>{result.data.total.count}</span>
              <span dir="ltr" className={FIGURE}>
                {money(result.data.total.amount)}
              </span>
            </div>
          ) : undefined
        }
      >
        <div role="table" aria-label={t('year.title', { year })}>
          <TableHead
            columns={COLUMNS}
            labels={[
              t('year.month'),
              <span key="count" className="block text-end">
                {t('year.count')}
              </span>,
              <span key="amount" className="block text-end">
                {t('year.amount')}
              </span>,
            ]}
          />
          {result.isPending ? (
            <SkeletonRows columns={COLUMNS} label={t('loading')} />
          ) : result.isError && !result.data ? (
            <ErrorState
              title={t('errorTitle')}
              body={t('errorBody')}
              requestId={result.error instanceof ApiError ? result.error.requestId : undefined}
              error={result.error}
              onRetry={() => void result.refetch()}
            />
          ) : (
            result.data.months.map((row) => (
              <button
                key={row.month}
                type="button"
                role="row"
                onClick={() => {
                  onMonth(row.month);
                }}
                className="grid min-h-11 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-row-divider bg-transparent px-3 text-start text-[13px] text-ink hover:bg-faint"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span role="cell" className="font-medium">
                  {formatMonth(row.month, locale)}
                </span>
                <span role="cell" className={FIGURE}>
                  {row.count}
                </span>
                <span role="cell" dir="ltr" className={FIGURE}>
                  {money(row.amount)}
                </span>
              </button>
            ))
          )}
        </div>
      </TableCard>
    </>
  );
}
