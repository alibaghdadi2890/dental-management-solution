import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { EmptyState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { DashboardPage } from '@/features/dashboards/dashboard-page';
import { parseDashboardSearch } from '@/features/dashboards/dashboard-search';

export const Route = createFileRoute('/_app/dashboard')({
  staticData: { navKey: 'dashboard' },
  validateSearch: parseDashboardSearch,
  component: DashboardRoute,
});

function DashboardRoute() {
  const { t } = useTranslation('dashboards');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  const allowed =
    session.permissions.includes('dashboard:financial') ||
    session.permissions.includes('dashboard:operational');
  if (!allowed) {
    return (
      <Page title={t('title')} subtitle="">
        <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />
      </Page>
    );
  }
  return (
    <DashboardPage
      session={session}
      search={search}
      onSearch={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}
