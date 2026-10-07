import { createFileRoute, type SearchSchemaInput, stripSearchParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { EmptyState } from '@/components/ui/list';
import { ActivityPage } from '@/features/audit/activity-page';
import {
  ACTIVITY_SEARCH_DEFAULTS,
  type ActivitySearchInput,
  parseActivitySearch,
} from '@/features/audit/activity-search';
import { useSession } from '@/features/auth/session';

export const Route = createFileRoute('/_app/activity')({
  staticData: { navKey: 'activity' },
  validateSearch: (search: ActivitySearchInput & SearchSchemaInput) => parseActivitySearch(search),
  search: { middlewares: [stripSearchParams(ACTIVITY_SEARCH_DEFAULTS)] },
  component: ActivityRoute,
});

function ActivityRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  const { t } = useTranslation('activity');
  if (!session?.tenant) return null;
  // The nav hides the screen; a typed URL lands here, and the API would refuse the read (403).
  if (!session.permissions.includes('audit:read')) {
    return (
      <Page title={t('title')} subtitle={t('subtitle')}>
        <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />
      </Page>
    );
  }
  return (
    <ActivityPage
      search={search}
      tenant={session.tenant}
      onSearch={(next, options) => {
        void navigate({ search: next, replace: options?.replace ?? false });
      }}
    />
  );
}
