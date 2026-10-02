import { createFileRoute, type SearchSchemaInput, stripSearchParams } from '@tanstack/react-router';
import { VisitsPage } from '@/features/clinical/visits-list/visits-page';
import {
  parseVisitsSearch,
  VISITS_SEARCH_DEFAULTS,
  type VisitsSearchInput,
} from '@/features/clinical/visits-list/visits-search';

export const Route = createFileRoute('/_app/visits/')({
  staticData: { navKey: 'visits' },
  validateSearch: (search: VisitsSearchInput & SearchSchemaInput) => parseVisitsSearch(search),
  search: { middlewares: [stripSearchParams(VISITS_SEARCH_DEFAULTS)] },
  component: VisitsRoute,
});

function VisitsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <VisitsPage
      search={search}
      onSearch={(next, options) => {
        void navigate({ search: next, replace: options?.replace ?? false });
      }}
    />
  );
}
