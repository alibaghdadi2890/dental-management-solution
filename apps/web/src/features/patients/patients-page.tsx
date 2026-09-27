import {
  type BalanceMoney,
  exportLanguageSchema,
  type PatientListItem,
  type PatientListQuery,
} from '@dcm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, TableCard, ViewTabs } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { balancesQuery } from '@/features/billing/billing-api';
import { ApiError } from '@/lib/api';
import { todayIn } from '@/lib/format';
import { BulkBar } from './bulk-bar';
import { DuplicateBanner } from './duplicate-banner';
import { FilterBar } from './filter-bar';
import {
  activeFilterCount,
  clearFilters,
  listQueryOf,
  type PatientPanel,
  type PatientsSearch,
  panelParam,
  parsePanel,
  sortPatch,
  toSearch,
  withFilter,
} from './list-query';
import { PagerBar } from './pager-bar';
import { PatientRowMenu } from './patient-row-menu';
import {
  duplicatesQuery,
  downloadExport,
  owingCountQuery,
  patientCountsQuery,
  patientListQuery,
  practitionersQuery,
} from './patients-api';
import {
  PATIENT_TABLE_MIN_WIDTH,
  PatientRow,
  type PatientRowContext,
  PatientsSkeleton,
  PatientsTableHead,
} from './patients-table';
import { useArchivePatients } from './use-archive-patients';

const VIEWS = ['active', 'owing', 'notSeen', 'archived'] as const;
const NO_SELECTION: ReadonlySet<string> = new Set();

type OnSearch = (next: PatientsSearch, options?: { replace?: boolean }) => void;

/**
 * The Patients list (`Patients.dc.html`, README §Patients, design §Patients list). All list state
 * lives in the URL search (`search`/`onSearch`, wired by the route); the row selection is local
 * and resets whenever the query changes. The page is a flex row: the list, then the right panel
 * that `panel` opens.
 *
 * A row click opens the quick view: the patient record route (`/patients/$patientId`) does not
 * exist yet, so "Open record" is not offered either.
 */
export function PatientsPage({ search, onSearch }: { search: PatientsSearch; onSearch: OnSearch }) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const toast = useToast();
  const { data: session } = useSession();
  const canWrite = usePermission('patient:write');
  const canPay = usePermission('payment:read');

  const query = listQueryOf(search);
  const panel = parsePanel(search.panel);
  const locale = i18n.resolvedLanguage ?? 'en';
  const tenant = session?.tenant;

  const list = useQuery({ ...patientListQuery(query), placeholderData: keepPreviousData });
  const counts = useQuery(patientCountsQuery());
  const owing = useQuery({ ...owingCountQuery(), enabled: canPay });
  const duplicates = useQuery(duplicatesQuery());
  const practitioners = useQuery(practitionersQuery());
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const ids = rows.map((row) => row.id);
  const balances = useQuery({ ...balancesQuery(ids), enabled: canPay && ids.length > 0 });

  const selectionKey = JSON.stringify(toSearch(query));
  const [selection, setSelection] = useState({ key: selectionKey, ids: NO_SELECTION });
  const selected = selection.key === selectionKey ? selection.ids : NO_SELECTION;
  const setSelected = (next: ReadonlySet<string>) => {
    setSelection({ key: selectionKey, ids: next });
  };
  const clearSelection = () => {
    setSelected(NO_SELECTION);
  };
  const { archive, restore } = useArchivePatients({ onDone: clearSelection });

  // `next` replaces the whole list query: a filter it clears is absent, not `undefined`, so
  // spreading it over `search` would keep the old value.
  const setQuery = (next: PatientListQuery, options?: { replace?: boolean }) => {
    onSearch(
      { ...next, panel: search.panel, fullName: search.fullName, phone: search.phone },
      options,
    );
  };
  const openPanel = (next: PatientPanel) => {
    onSearch({ ...search, panel: panelParam(next) });
  };

  // A page past the end (after archiving the last rows of the last page, or a stale URL) moves
  // back to the last page that has rows.
  const data = list.isPlaceholderData ? undefined : list.data;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / query.size)) : 1;
  const stepBack = useEffectEvent((page: number) => {
    setQuery({ ...query, page }, { replace: true });
  });
  const pastEnd = data !== undefined && data.items.length === 0 && query.page > lastPage;
  useEffect(() => {
    if (pastEnd) stepBack(lastPage);
  }, [pastEnd, lastPage]);

  const exportLanguage = exportLanguageSchema.safeParse(locale).data;
  const runExport = (request: Parameters<typeof downloadExport>[0]) => {
    downloadExport(request, exportLanguage).catch((error: unknown) => {
      const reason = error instanceof ApiError ? error.problem.title : t('common:unexpected');
      toast(t('exportFailed', { reason }), { tone: 'danger' });
    });
  };

  const groups = duplicates.data ?? [];
  const twins = useMemo(() => {
    const byId = new Map<string, PatientListItem>();
    for (const { patients } of duplicates.data ?? []) {
      for (const patient of patients) {
        const twin = patients.find((other) => other.id !== patient.id);
        if (twin) byId.set(patient.id, twin);
      }
    }
    return byId;
  }, [duplicates.data]);
  const duplicateCount = groups.reduce((sum, group) => sum + group.patients.length, 0);
  const [firstA, firstB] = groups[0]?.patients ?? [];

  const balanceById = useMemo(() => {
    const byId = new Map<string, readonly BalanceMoney[]>();
    for (const entry of balances.data ?? []) byId.set(entry.patientId, entry.balances);
    return byId;
  }, [balances.data]);

  const context: PatientRowContext = {
    today: todayIn(tenant?.timeZone ?? 'UTC'),
    country: tenant?.country ?? 'LB',
    currency: tenant?.currency ?? 'USD',
    locale,
    dentistNames: new Map(practitioners.data?.map((p) => [p.userId, p.displayName]) ?? []),
  };

  const viewCount = {
    active: counts.data?.active,
    owing: owing.data?.count,
    notSeen: counts.data?.notSeen,
    archived: counts.data?.archived,
  };
  const viewLabel = t(`views.${query.view}`);
  const filtered = activeFilterCount(query) > 0;
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const archivedView = query.view === 'archived';
  const [mergeA, mergeB] = selectedRows;

  let subtitle = t('subtitleLoading');
  if (counts.data) {
    subtitle =
      canPay && owing.data
        ? t('subtitle', { active: counts.data.active, owing: owing.data.count })
        : t('subtitleActive', { active: counts.data.active });
  }

  const newPatient = canWrite ? (
    <Button
      variant="primary"
      onClick={() => {
        openPanel({ kind: 'new' });
      }}
    >
      {t('new')}
    </Button>
  ) : undefined;

  let body: ReactNode;
  if (list.isPending || pastEnd) {
    body = <PatientsSkeleton label={t('loading')} />;
  } else if (list.isError) {
    body = (
      <ErrorState
        title={t('error.title')}
        body={t('error.body')}
        requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (list.data.total === 0 && query.view === 'active' && !filtered) {
    body = <EmptyState title={t('empty.title')} body={t('empty.body')} action={newPatient} />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        title={t('noResults.title')}
        body={
          filtered
            ? t('noResults.body', { view: viewLabel })
            : t('noResults.bodyView', { view: viewLabel })
        }
        action={
          filtered ? (
            <Button
              variant="outline"
              size="toolbar"
              onClick={() => {
                setQuery(clearFilters(query));
              }}
            >
              {t('noResults.clear')}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = rows.map((patient) => (
      <PatientRow
        key={patient.id}
        patient={patient}
        context={context}
        balances={balanceById.get(patient.id)}
        selected={selected.has(patient.id)}
        highlighted={panel !== null && 'id' in panel && panel.id === patient.id}
        onToggle={() => {
          const next = new Set(selected);
          if (!next.delete(patient.id)) next.add(patient.id);
          setSelected(next);
        }}
        onOpen={() => {
          openPanel({ kind: 'quick', id: patient.id });
        }}
        menu={
          <PatientRowMenu
            patient={patient}
            twin={twins.get(patient.id)}
            canWrite={canWrite}
            onPanel={openPanel}
            onArchive={() => {
              archive([patient]);
            }}
            onRestore={() => {
              restore([patient]);
            }}
          />
        }
      />
    ));
  }

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">
        <Page
          title={t('title')}
          subtitle={subtitle}
          actions={
            <>
              {canPay && (
                <Button
                  variant="outline"
                  onClick={() => {
                    runExport({ query });
                  }}
                >
                  {t('exportCsv')}
                </Button>
              )}
              {newPatient}
            </>
          }
        >
          <ViewTabs
            label={t('views.label')}
            active={query.view}
            onChange={(view) => {
              setQuery(withFilter(query, { view }));
            }}
            tabs={VIEWS.filter((view) => canPay || view !== 'owing').map((view) => ({
              key: view,
              label: t(`views.${view}`),
              count: viewCount[view],
            }))}
          />
          {query.view === 'active' && duplicateCount > 0 && (
            <DuplicateBanner
              count={duplicateCount}
              onReview={
                canWrite && firstA && firstB
                  ? () => {
                      openPanel({ kind: 'merge', ids: [firstA.id, firstB.id] });
                    }
                  : undefined
              }
            />
          )}
          <FilterBar query={query} practitioners={practitioners.data ?? []} onChange={setQuery} />
          <TableCard
            minWidth={PATIENT_TABLE_MIN_WIDTH}
            toolbar={
              selectedRows.length > 0 && (
                <BulkBar
                  count={selectedRows.length}
                  onMerge={
                    canWrite && !archivedView && selectedRows.length === 2 && mergeA && mergeB
                      ? () => {
                          openPanel({ kind: 'merge', ids: [mergeA.id, mergeB.id] });
                        }
                      : undefined
                  }
                  onExport={
                    canPay
                      ? () => {
                          runExport({ ids: selectedRows.map((row) => row.id) });
                        }
                      : undefined
                  }
                  onArchive={
                    canWrite && !archivedView
                      ? () => {
                          archive(selectedRows);
                        }
                      : undefined
                  }
                  onRestore={
                    canWrite && archivedView
                      ? () => {
                          restore(selectedRows);
                        }
                      : undefined
                  }
                  onClear={clearSelection}
                />
              )
            }
            footer={
              list.data && rows.length > 0 ? (
                <PagerBar
                  page={query.page}
                  size={query.size}
                  total={list.data.total}
                  onPage={(page) => {
                    setQuery({ ...query, page });
                  }}
                  onSize={(size) => {
                    setQuery(withFilter(query, { size }));
                  }}
                />
              ) : undefined
            }
          >
            <div role="table" aria-label={t('columns.table')}>
              <PatientsTableHead
                query={query}
                onSort={(column) => {
                  setQuery(withFilter(query, sortPatch(query, column)));
                }}
                canSortBalance={canPay}
                allSelected={allSelected}
                selectable={rows.length > 0}
                onToggleAll={() => {
                  setSelected(allSelected ? NO_SELECTION : new Set(rows.map((row) => row.id)));
                }}
              />
              {body}
            </div>
          </TableCard>
        </Page>
      </div>
    </div>
  );
}
