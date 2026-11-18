import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { EmptyState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { LabPage } from '@/features/labs/lab-page';
import { parseLabSearch } from '@/features/labs/lab-search';

export const Route = createFileRoute('/_app/lab')({
  staticData: { navKey: 'lab' },
  validateSearch: parseLabSearch,
  component: LabRoute,
});

function LabRoute() {
  const { t } = useTranslation('labs');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  if (!session.permissions.includes('lab:read')) {
    return (
      <Page title={t('title')} subtitle={t('subtitle')}>
        <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />
      </Page>
    );
  }
  return (
    <LabPage
      session={session}
      search={search}
      onSearch={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}
