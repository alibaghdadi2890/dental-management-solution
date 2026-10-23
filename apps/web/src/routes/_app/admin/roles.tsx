import { createFileRoute } from '@tanstack/react-router';
import { DefaultRolesPage } from '@/features/platform/default-roles-page';

export const Route = createFileRoute('/_app/admin/roles')({
  staticData: { navKey: 'defaultRoles' },
  component: DefaultRolesPage,
});
