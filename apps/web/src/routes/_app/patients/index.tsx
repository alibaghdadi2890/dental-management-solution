import { createFileRoute, type SearchSchemaInput, stripSearchParams } from '@tanstack/react-router';
import {
  LIST_QUERY_DEFAULTS,
  parsePatientsSearch,
  type PatientsSearchInput,
} from '@/features/patients/list-query';
import { PatientsScreen } from '@/features/patients/patients-screen';

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
    <PatientsScreen
      search={search}
      navigate={(navigation) => {
        void navigate(navigation);
      }}
    />
  );
}
