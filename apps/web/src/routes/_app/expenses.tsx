import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { EmptyState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { ExpensesPage } from '@/features/expenses/expenses-page';
import { parseExpensesSearch } from '@/features/expenses/expenses-search';

export const Route = createFileRoute('/_app/expenses')({
  staticData: { navKey: 'expenses' },
  validateSearch: parseExpensesSearch,
  component: ExpensesRoute,
});

function ExpensesRoute() {
  const { t } = useTranslation('expenses');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  if (!session.permissions.includes('expense:read')) {
    return (
      <Page title={t('title')} subtitle={t('subtitle')}>
        <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />
      </Page>
    );
  }
  return (
    <ExpensesPage
      session={session}
      search={search}
      onSearch={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}
