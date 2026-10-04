import { idSchema } from '@dcm/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { TodayPage } from '@/features/today/today-page';

/** `?visit=<id>`: the visit whose checkout panel is open; anything else is dropped. */
function parseTodaySearch(search: Record<string, unknown>): { visit?: string } {
  const visit = idSchema.safeParse(search['visit']);
  return visit.success ? { visit: visit.data } : {};
}

export const Route = createFileRoute('/_app/today')({
  staticData: { navKey: 'today' },
  validateSearch: parseTodaySearch,
  component: TodayRoute,
});

function TodayRoute() {
  const { visit } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TodayPage
      openVisitId={visit}
      onOpen={(next) => {
        void navigate({ search: next ? { visit: next } : {}, replace: next === undefined });
      }}
    />
  );
}
