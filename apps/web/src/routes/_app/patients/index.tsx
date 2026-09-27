import { createFileRoute, type SearchSchemaInput, stripSearchParams } from '@tanstack/react-router';
import {
  LIST_QUERY_DEFAULTS,
  parsePatientsSearch,
  type PatientsSearchInput,
} from '@/features/patients/list-query';
import { PatientsPage } from '@/features/patients/patients-page';

export const Route = createFileRoute('/_app/patients/')({
  staticData: { navKey: 'patients' },
  validateSearch: (search: PatientsSearchInput & SearchSchemaInput) => parsePatientsSearch(search),
  search: { middlewares: [stripSearchParams(LIST_QUERY_DEFAULTS)] },
  component: PatientsRoute,
});

function PatientsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PatientsPage
      search={search}
      onSearch={(next, options) => {
        void navigate({ search: next, replace: options?.replace ?? false });
      }}
    />
  );
}
