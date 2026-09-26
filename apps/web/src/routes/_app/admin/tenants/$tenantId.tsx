import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { TenantDetailPage } from '@/features/platform/tenant-detail/tenant-detail-page';

export const Route = createFileRoute('/_app/admin/tenants/$tenantId')({
  staticData: { navKey: 'tenants' },
  validateSearch: z.object({ tab: z.enum(['overview', 'branches', 'settings']).optional() }),
  component: TenantDetailRoute,
});

function TenantDetailRoute() {
  const { tenantId } = Route.useParams();
  const { tab = 'overview' } = Route.useSearch();
  return <TenantDetailPage tenantId={tenantId} tab={tab} />;
}
