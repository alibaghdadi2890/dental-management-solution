import { createFileRoute } from '@tanstack/react-router';
import { VisitWorkspaceScreen } from '@/features/clinical/workspace/visit-workspace-page';

export const Route = createFileRoute('/_app/visits/$visitId')({
  staticData: { navKey: 'visits' },
  component: VisitWorkspaceRoute,
});

function VisitWorkspaceRoute() {
  const { visitId } = Route.useParams();
  return <VisitWorkspaceScreen visitId={visitId} />;
}
