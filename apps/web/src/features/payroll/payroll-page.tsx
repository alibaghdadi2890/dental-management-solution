import { exportLanguageSchema, type Session } from '@dcm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button, IconButton } from '@/components/ui/button';
import { ErrorState, SkeletonRows, TableCard, TableHead, ViewTabs } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { formatMonth, monthOf } from '@/features/compensation/months';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney, todayIn } from '@/lib/format';
import { EmployeesTab } from './employees-tab';
import { downloadPayrollYear, payrollMonthsQuery } from './payroll-api';
import { RunTab } from './run-tab';

export type PayrollTab = 'run' | 'employees' | 'year';

export interface PayrollSearch {
  tab?: 'employees' | 'year' | undefined;
  month?: string | undefined;
  year?: number | undefined;
}

const COLUMNS = 'minmax(160px,1fr) 160px 110px 110px';
const FIGURE = 'block text-end font-mono tabular-nums';

/** The net paid per payroll month of a year (B4), with export; a month opens its run. */
function YearTab({
  year,
  latestYear,
  currency,
  onYear,
  onMonth,
}: {
  year: number;
  latestYear: number;
  currency: string;
  onYear: (year: number) => void;
  onMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation('payroll');
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const result = useQuery({ ...payrollMonthsQuery(year), placeholderData: keepPreviousData });
  const [exporting, setExporting] = useState(false);
  const money = (amount: string) => formatMoney({ amount, currency }, locale);
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
        <Button
          variant="outline"
          className="ms-auto"
          busy={exporting}
          onClick={() => {
            setExporting(true);
            downloadPayrollYear(year, exportLanguageSchema.safeParse(locale).data)
              .catch((failure: unknown) => {
                toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
              })
              .finally(() => {
                setExporting(false);
              });
          }}
        >
          {t('year.export')}
        </Button>
      </div>
      <TableCard
        minWidth={540}
        footer={
          result.data ? (
            <div
              className="grid items-center gap-2.5 border-t border-border bg-faint px-3 py-2.5 text-[13px] font-semibold"
              style={{ gridTemplateColumns: COLUMNS }}
            >
              <span>{t('year.total')}</span>
              <span dir="ltr" className={FIGURE}>
                {money(result.data.paidNet)}
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
              <span key="net" className="block text-end">
                {t('year.paidNet')}
              </span>,
              <span key="paid" className="block text-end">
                {t('year.paid')}
              </span>,
              <span key="pending" className="block text-end">
                {t('year.pending')}
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
                <span role="cell" dir="ltr" className={FIGURE}>
                  {money(row.paidNet)}
                </span>
                <span role="cell" className={FIGURE}>
                  {row.paidCount}
                </span>
                <span role="cell" className={FIGURE}>
                  {row.pendingCount}
                </span>
              </button>
            ))
          )}
        </div>
      </TableCard>
    </>
  );
}

/**
 * Payroll (feature 17, B1–B4, `payroll:read`): the monthly run, the employees with their salary
 * history, and the year month by month. Dentists are not here (they are paid through
 * Compensation, ADR-0077). The tab, month and year live in the URL.
 */
export function PayrollPage({
  session,
  search,
  onSearch,
}: {
  session: Session;
  search: PayrollSearch;
  onSearch: (next: PayrollSearch) => void;
}) {
  const { t } = useTranslation('payroll');
  const canManage = usePermission('payroll:manage');
  const tenant = session.tenant;
  if (!tenant) return null;
  const currentMonth = monthOf(todayIn(tenant.timeZone));
  const currentYear = Number(currentMonth.slice(0, 4));
  const tab: PayrollTab = search.tab ?? 'run';
  return (
    <Page title={t('title')} subtitle={t('subtitle')}>
      <ViewTabs
        label={t('tabs.label')}
        tabs={[
          { key: 'run', label: t('tabs.run') },
          { key: 'employees', label: t('tabs.employees') },
          { key: 'year', label: t('tabs.year') },
        ]}
        active={tab}
        onChange={(key) => {
          onSearch(key === 'run' ? {} : { tab: key });
        }}
      />
      {tab === 'run' && (
        <RunTab
          month={search.month ?? currentMonth}
          currentMonth={currentMonth}
          tenant={tenant}
          canManage={canManage}
          onMonth={(month) => {
            onSearch(month === currentMonth ? {} : { month });
          }}
        />
      )}
      {tab === 'employees' && (
        <EmployeesTab session={session} tenant={tenant} canManage={canManage} />
      )}
      {tab === 'year' && (
        <YearTab
          year={search.year ?? currentYear}
          latestYear={currentYear}
          currency={tenant.currency}
          onYear={(year) => {
            onSearch({ tab: 'year', ...(year === currentYear ? {} : { year }) });
          }}
          onMonth={(month) => {
            onSearch(month === currentMonth ? {} : { month });
          }}
        />
      )}
    </Page>
  );
}
