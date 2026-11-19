import { TooltipProvider } from '@/components/ui/tooltip';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { EmptyState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { InventoryPage } from '@/features/inventory/inventory-page';
import { parseInventorySearch } from '@/features/inventory/inventory-search';

export const Route = createFileRoute('/_app/inventory/')({
  staticData: { navKey: 'inventory' },
  validateSearch: parseInventorySearch,
  component: InventoryRoute,
});

function InventoryRoute() {
  const { t } = useTranslation('inventory');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  if (!session.permissions.includes('inventory:read')) {
    return (
      <Page title={t('title')}>
        <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />
      </Page>
    );
  }
  return (
    <TooltipProvider>
      <InventoryPage
        session={session}
        search={search}
        onSearch={(next) => {
          void navigate({ search: parseInventorySearch(next), replace: true });
        }}
      />
    </TooltipProvider>
  );
}
