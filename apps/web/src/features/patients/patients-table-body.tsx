import type { PatientListItem, PatientListQuery, PatientPage } from '@dcm/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/list';
import { ApiError } from '@/lib/api';
import { activeFilterCount } from './list-query';
import { PatientsSkeleton } from './patients-table';

/**
 * The table's body for each state (README §System states): skeleton while loading (or while a
 * page past the end steps back), the error with its request id, the clinic's empty state, "no
 * results" naming the view, or the rows. Empty and no-results only ever describe a settled
 * answer — never the previous query's placeholder rows.
 */
export function PatientsTableBody({
  list,
  query,
  steppingBack,
  newPatient,
  onClearFilters,
  renderRow,
}: {
  list: UseQueryResult<PatientPage>;
  query: PatientListQuery;
  steppingBack: boolean;
  /** The "New patient" action, when the user may create one. */
  newPatient: ReactNode;
  onClearFilters: () => void;
  renderRow: (patient: PatientListItem) => ReactNode;
}) {
  const { t } = useTranslation('patients');
  const filtered = activeFilterCount(query) > 0;
  const viewLabel = t(`views.${query.view}`);

  if (list.isError) {
    return (
      <ErrorState
        title={t('error.title')}
        body={t('error.body')}
        requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
        onRetry={() => void list.refetch()}
      />
    );
  }
  const rows = list.data?.items ?? [];
  if (list.isPending || steppingBack || (list.isPlaceholderData && rows.length === 0)) {
    return <PatientsSkeleton label={t('loading')} />;
  }
  if (rows.length > 0) return rows.map(renderRow);
  if (list.data.total === 0 && query.view === 'active' && !filtered) {
    return <EmptyState title={t('empty.title')} body={t('empty.body')} action={newPatient} />;
  }
  return (
    <EmptyState
      title={t('noResults.title')}
      body={
        filtered
          ? t('noResults.body', { view: viewLabel })
          : t('noResults.bodyView', { view: viewLabel })
      }
      action={
        filtered ? (
          <Button variant="outline" size="toolbar" onClick={onClearFilters}>
            {t('noResults.clear')}
          </Button>
        ) : undefined
      }
    />
  );
}
