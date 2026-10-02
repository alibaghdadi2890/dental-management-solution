import { createFileRoute, type SearchSchemaInput, stripSearchParams } from '@tanstack/react-router';
import { PatientRecordScreen } from '@/features/patients/record/patient-record-page';
import {
  DEFAULT_RECORD_TAB,
  parseRecordSearch,
  type RecordSearchInput,
} from '@/features/patients/record/record-search';

export const Route = createFileRoute('/_app/patients/$patientId')({
  staticData: { navKey: 'patients' },
  validateSearch: (search: RecordSearchInput & SearchSchemaInput) => parseRecordSearch(search),
  search: { middlewares: [stripSearchParams({ tab: DEFAULT_RECORD_TAB })] },
  component: PatientRecordRoute,
});

function PatientRecordRoute() {
  const { patientId } = Route.useParams();
  const { tab, panel, view, visitId } = Route.useSearch();
  return (
    <PatientRecordScreen
      patientId={patientId}
      tab={tab}
      panel={panel}
      view={view}
      visitId={visitId}
    />
  );
}
