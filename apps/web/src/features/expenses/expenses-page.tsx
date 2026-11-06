import type { Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { ViewTabs } from '@/components/ui/list';
import { usePermission } from '@/features/auth/use-permission';
import { monthOf } from '@/features/compensation/months';
import { todayIn } from '@/lib/format';
import { CategoriesTab } from './categories-tab';
import { ExpensePanel } from './expense-panel';
import { categoriesQuery } from './expenses-api';
import type { ExpensesSearch, ExpenseTab } from './expenses-search';
import { FixedTab } from './fixed-tab';
import { HistoryTab } from './history-tab';
import { YearTab } from './year-tab';

/**
 * Expenses (feature 17, A1–A4, `expense:read`): the History of what the clinic paid (salaries
 * and payouts only for those who may see them), the Year month by month, the fixed expenses and
 * — for whoever manages expenses — the categories. The tab and the History filter are in the URL.
 */
export function ExpensesPage({
  session,
  search,
  onSearch,
}: {
  session: Session;
  search: ExpensesSearch;
  onSearch: (next: ExpensesSearch) => void;
}) {
  const { t } = useTranslation('expenses');
  const canManage = usePermission('expense:manage');
  const categories = useQuery(categoriesQuery());
  const [recording, setRecording] = useState(false);
  const tenant = session.tenant;
  if (!tenant) return null;
  const currentMonth = monthOf(todayIn(tenant.timeZone));
  const currentYear = Number(currentMonth.slice(0, 4));
  const tab: ExpenseTab = search.tab ?? 'history';
  const tabs = [
    { key: 'history' as const, label: t('tabs.history') },
    { key: 'year' as const, label: t('tabs.year') },
    { key: 'fixed' as const, label: t('tabs.fixed') },
    ...(canManage ? [{ key: 'categories' as const, label: t('tabs.categories') }] : []),
  ];
  const list = categories.data ?? [];

  return (
    <Page title={t('title')} subtitle={t('subtitle')}>
      <ViewTabs
        label={t('tabs.label')}
        tabs={tabs}
        active={tab}
        onChange={(key) => {
          onSearch(key === 'history' ? {} : { tab: key });
        }}
      />
      {tab === 'history' && (
        <HistoryTab
          search={search}
          onSearch={(patch) => {
            onSearch({ ...search, ...patch });
          }}
          session={session}
          tenant={tenant}
          categories={list}
          currentMonth={currentMonth}
          canManage={canManage}
          onRecord={() => {
            setRecording(true);
          }}
        />
      )}
      {tab === 'year' && (
        <YearTab
          year={search.year ?? currentYear}
          latestYear={currentYear}
          tenant={tenant}
          onYear={(year) => {
            onSearch({ tab: 'year', ...(year === currentYear ? {} : { year }) });
          }}
          onMonth={(month) => {
            onSearch(month === currentMonth ? {} : { month });
          }}
        />
      )}
      {tab === 'fixed' && (
        <FixedTab tenant={tenant} session={session} categories={list} canManage={canManage} />
      )}
      {tab === 'categories' && canManage && <CategoriesTab categories={list} />}
      {recording && (
        <ExpensePanel
          mode={{ kind: 'record' }}
          tenant={tenant}
          categories={list}
          branches={session.branches}
          onClose={() => {
            setRecording(false);
          }}
        />
      )}
    </Page>
  );
}
