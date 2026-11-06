import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { EmptyState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { parseMonth } from '@/features/compensation/months';
import { PayrollPage, type PayrollSearch } from '@/features/payroll/payroll-page';

/** `?tab=employees|year`, `?month=YYYY-MM` (the run), `?year=` (the Year tab); the rest dropped. */
function parsePayrollSearch(search: Record<string, unknown>): PayrollSearch {
  const tab = search['tab'] === 'employees' || search['tab'] === 'year' ? search['tab'] : undefined;
  const month = parseMonth(search['month'], '') || undefined;
  const year = Number(search['year']);
  return {
    ...(tab ? { tab } : {}),
    ...(month ? { month } : {}),
    ...(Number.isInteger(year) && year >= 2000 && year <= 2100 ? { year } : {}),
  };
}

export const Route = createFileRoute('/_app/payroll')({
  staticData: { navKey: 'payroll' },
  validateSearch: parsePayrollSearch,
  component: PayrollRoute,
});

function PayrollRoute() {
  const { t } = useTranslation('payroll');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  // Salaries are confidential (ADR-0080): a platform admin never holds payroll either.
  if (!session.permissions.includes('payroll:read')) {
    return (
      <Page title={t('title')} subtitle={t('subtitle')}>
        <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />
      </Page>
    );
  }
  return (
    <PayrollPage
      session={session}
      search={search}
      onSearch={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}
