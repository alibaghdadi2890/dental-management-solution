import { createFileRoute, type SearchSchemaInput, stripSearchParams } from '@tanstack/react-router';
import {
  LIST_QUERY_DEFAULTS,
  panelParam,
  parsePatientsSearch,
  type PatientsSearchInput,
} from '@/features/patients/list-query';
import { PatientPanel } from '@/features/patients/panels/patient-panel';
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
        void navigate({
          search: next,
          replace: options?.replace ?? false,
          state: { patientsPanelPushed: options?.panelPushed ?? false },
        });
      }}
      renderPanel={(panel, { close, open }) => (
        <PatientPanel
          key={panelParam(panel)}
          panel={panel}
          prefill={{ fullName: search.fullName, phone: search.phone }}
          onClose={close}
          onOpen={open}
        />
      )}
    />
  );
}
