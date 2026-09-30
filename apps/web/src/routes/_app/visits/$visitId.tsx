import type { ToothCode } from '@dcm/contracts';
import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router';
import { VisitWorkspaceScreen } from '@/features/clinical/workspace/visit-workspace-page';
import { parseWorkspaceSearch } from '@/features/clinical/workspace/workspace-search';

export const Route = createFileRoute('/_app/visits/$visitId')({
  staticData: { navKey: 'visits' },
  validateSearch: (search: { tooth?: ToothCode } & SearchSchemaInput) =>
    parseWorkspaceSearch(search),
  component: VisitWorkspaceRoute,
});

function VisitWorkspaceRoute() {
  const { visitId } = Route.useParams();
  const { tooth } = Route.useSearch();
  return <VisitWorkspaceScreen visitId={visitId} tooth={tooth} />;
}
