import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PlatformActivityPage } from '@/features/audit/platform-activity-page';
import {
  type PlatformActivitySearch,
  parsePlatformActivitySearch,
} from '@/features/audit/platform-activity-search';

export const Route = createFileRoute('/_app/admin/activity')({
  staticData: { navKey: 'platformActivity' },
  validateSearch: (search: Record<string, unknown>): PlatformActivitySearch =>
    parsePlatformActivitySearch(search),
  component: PlatformActivityRoute,
});

function PlatformActivityRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <PlatformActivityPage
      search={search}
      onSearch={(next, options) => {
        void navigate({ to: '/admin/activity', search: next, replace: options?.replace });
      }}
    />
  );
}
