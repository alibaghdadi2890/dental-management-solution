import { createFileRoute } from '@tanstack/react-router';
import { TenantsPage } from '@/features/platform/tenants-page';

export const Route = createFileRoute('/_app/admin/tenants/')({
  staticData: { navKey: 'tenants' },
  component: TenantsPage,
});
