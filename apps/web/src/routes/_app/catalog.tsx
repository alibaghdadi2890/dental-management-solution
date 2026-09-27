import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { CatalogPage } from '@/features/clinical/catalog/catalog-page';

export const Route = createFileRoute('/_app/catalog')({
  staticData: { navKey: 'catalog' },
  validateSearch: z.object({ tab: z.enum(['services', 'diagnoses']).optional() }),
  component: CatalogRoute,
});

function CatalogRoute() {
  const { tab = 'services' } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CatalogPage
      tab={tab}
      onTabChange={(next) => {
        void navigate({ search: { tab: next === 'services' ? undefined : next }, replace: true });
      }}
    />
  );
}
