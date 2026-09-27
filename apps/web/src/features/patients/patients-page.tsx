import { exportLanguageSchema, type PatientListQuery, type Session } from '@dcm/contracts';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { TableCard, ViewTabs } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { ApiError } from '@/lib/api';
import { todayIn } from '@/lib/format';
import { BulkBar } from './bulk-bar';
import { DuplicateBanner } from './duplicate-banner';
import { FilterBar } from './filter-bar';
import {
  clearFilters,
  listQueryOf,
  type PatientPanel,
  type PatientsSearch,
  panelParam,
  parsePanel,
  parsePatientsSearch,
  sortPatch,
  toSearch,
  withFilter,
  withoutBalanceViews,
} from './list-query';
import { PagerBar } from './pager-bar';
import { PatientRowMenu } from './patient-row-menu';
import { downloadExport, type PatientExportRequest } from './patients-api';
import {
  PATIENT_TABLE_MIN_WIDTH,
  PatientRow,
  type PatientRowContext,
  PatientsTableHead,
} from './patients-table';
import { PatientsTableBody } from './patients-table-body';
import { useArchivePatients } from './use-archive-patients';
import { usePatientsListData } from './use-patients-list-data';

const VIEWS = ['active', 'owing', 'notSeen', 'archived'] as const;
const NO_SELECTION: ReadonlySet<string> = new Set();

type Tenant = NonNullable<Session['tenant']>;

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** On the history entry that opening a panel from the list pushed: closing that panel goes
     * back to the entry before it instead of adding a second, identical list entry. */
    patientsPanelPushed?: boolean;
  }
}

export interface SearchOptions {
  replace?: boolean;
  /** The new entry shows a panel opened from the list (`HistoryState.patientsPanelPushed`). */
  panelPushed?: boolean;
}

type OnSearch = (next: PatientsSearch, options?: SearchOptions) => void;

export interface PanelActions {
  close: () => void;
  /** Swaps the open panel for another (quick view → edit, a duplicate's "Open"). */
  open: (panel: PatientPanel) => void;
}

/** Renders the open right panel next to the list (README: 440px, pushes the table). */
export type RenderPanel = (panel: PatientPanel, actions: PanelActions) => ReactNode;

interface PatientsPageProps {
  search: PatientsSearch;
  onSearch: OnSearch;
  renderPanel?: RenderPanel;
}

/**
 * The Patients list (`Patients.dc.html`, README §Patients, design §Patients list). All list state
 * lives in the URL search (`search`/`onSearch`, wired by `PatientsScreen` for the route and the
 * tests); the row selection is local and resets whenever the query changes. The page is a flex
 * row: the list, then whatever `renderPanel` draws for the open `panel`.
 *
 * A row click opens the quick view: the patient record route (`/patients/$patientId`) does not
 * exist yet, so "Open record" is not offered either. Nothing renders until the session has a
 * tenant (the `_app` guard loads it first).
 *
 * History: opening a panel from the list pushes an entry; swapping panels replaces it; closing a
 * panel the list opened goes back (so Back afterwards leaves the list rather than landing on the
 * same list again). A panel reached any other way — a shared link, or a filter changed while it
 * was open — is closed by replacing its entry.
 */
export function PatientsPage(props: PatientsPageProps) {
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  return <PatientsList {...props} tenant={session.tenant} />;
}

function PatientsList({
  search,
  onSearch,
  renderPanel,
  tenant,
}: PatientsPageProps & { tenant: Tenant }) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const toast = useToast();
  const canWrite = usePermission('patient:write');
  const canPay = usePermission('payment:read');
  const router = useRouter();
  const locale = i18n.resolvedLanguage ?? 'en';
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);

  const requested = listQueryOf(search);
  const query = canPay ? requested : withoutBalanceViews(requested);
  const fellBack = query !== requested;
  const panel = parsePanel(search.panel);

  const data = usePatientsListData(query, { canPay });
  const { list, rows } = data;
  const stale = list.isPlaceholderData;

  const selectionKey = JSON.stringify(toSearch(query));
  const [selection, setSelection] = useState({ key: selectionKey, ids: NO_SELECTION });
  const selected = stale || selection.key !== selectionKey ? NO_SELECTION : selection.ids;
  const setSelected = (next: ReadonlySet<string>) => {
    setSelection({ key: selectionKey, ids: next });
  };
  const clearSelection = () => {
    setSelected(NO_SELECTION);
  };

  const tableRef = useRef<HTMLDivElement>(null);
  const archiving = useArchivePatients({
    onDone: clearSelection,
    focusAfter: () => {
      tableRef.current?.focus();
    },
  });

  // `next` replaces the whole list query: a filter it clears is absent, not `undefined`, so
  // spreading it over `search` would keep the old value.
  const setQuery = (next: PatientListQuery, options?: { replace?: boolean }) => {
    onSearch(
      { ...next, panel: search.panel, fullName: search.fullName, phone: search.phone },
      options,
    );
  };
  // Opening a panel from the list drops any create pre-fill (it belongs to a "New patient" the
  // shell opened), and swaps an already open panel rather than stacking history entries. It reads
  // the location as it is when called, not as it was rendered: a toast's "Open record" runs after
  // its panel has closed, and possibly after the filters changed.
  const openPanel = (next: PatientPanel | null) => {
    const { location } = router.state;
    const current = parsePatientsSearch(location.search);
    const open = parsePanel(current.panel) !== null;
    const pushed = open && location.state.patientsPanelPushed === true;
    if (next === null && pushed) {
      router.history.back();
      return;
    }
    onSearch(
      { ...listQueryOf(current), panel: panelParam(next) },
      { replace: open, panelPushed: next !== null && (!open || pushed) },
    );
  };

  // A page past the end (after archiving the last rows of the last page, or a stale URL) moves
  // back to the last page that has rows.
  const settled = stale ? undefined : list.data;
  const lastPage = settled ? Math.max(1, Math.ceil(settled.total / query.size)) : 1;
  const steppingBack = settled !== undefined && settled.items.length === 0 && query.page > lastPage;
  const stepBack = useEffectEvent((page: number) => {
    setQuery({ ...query, page }, { replace: true });
  });
  useEffect(() => {
    if (steppingBack) stepBack(lastPage);
  }, [steppingBack, lastPage]);
  // Without `payment:read` a balance view has already been swapped for its fallback above; make
  // the URL say so too.
  const showFallback = useEffectEvent(() => {
    setQuery(query, { replace: true });
  });
  useEffect(() => {
    if (fellBack) showFallback();
  }, [fellBack]);

  const [exporting, setExporting] = useState(false);
  const exportLanguage = exportLanguageSchema.safeParse(locale).data;
  const runExport = (request: PatientExportRequest) => {
    setExporting(true);
    downloadExport(request, exportLanguage)
      .catch((error: unknown) => {
        const reason = error instanceof ApiError ? error.problem.title : t('common:unexpected');
        toast(t('exportFailed', { reason }), { tone: 'danger' });
      })
      .finally(() => {
        setExporting(false);
      });
  };

  const context: PatientRowContext = {
    today: todayIn(tenant.timeZone),
    country: tenant.country,
    currency: tenant.currency,
    locale,
    dentistNames: data.dentistNames,
  };

  const viewCounts = {
    active: data.counts?.active,
    owing: data.owingCount,
    notSeen: data.counts?.notSeen,
    archived: data.counts?.archived,
  };
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const archivedView = query.view === 'archived';
  const [mergeA, mergeB] = selectedRows;
  const pageSelection =
    selectedRows.length === 0 ? 'none' : selectedRows.length === rows.length ? 'all' : 'some';
  const firstPair = data.firstPair;

  let subtitle = t('subtitleLoading');
  if (data.counts) {
    const active = t('subtitleActive', { count: data.counts.active });
    subtitle =
      data.owingCount === undefined
        ? active
        : t('subtitle', { active, owing: t('subtitleOwing', { count: data.owingCount }) });
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
                  busy={exporting}
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
            tabs={VIEWS.filter((view) => canPay || view !== 'owing').map((view) => {
              const value = viewCounts[view];
              return {
                key: view,
                label: t(`views.${view}`),
                count: value === undefined ? undefined : count(value),
              };
            })}
          />
          {query.view === 'active' && data.duplicateCount > 0 && (
            <DuplicateBanner
              count={data.duplicateCount}
              onReview={
                canWrite && firstPair
                  ? () => {
                      openPanel({ kind: 'merge', ids: firstPair });
                    }
                  : undefined
              }
            />
          )}
          <FilterBar
            query={query}
            practitioners={data.practitioners}
            dentistNames={data.dentistNames}
            onChange={setQuery}
          />
          <TableCard
            minWidth={PATIENT_TABLE_MIN_WIDTH}
            toolbar={
              selectedRows.length > 0 && (
                <BulkBar
                  count={selectedRows.length}
                  archiving={archiving.busy}
                  exporting={exporting}
                  onMerge={
                    canWrite && !archivedView && mergeA && mergeB && selectedRows.length === 2
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
                          archiving.archive(selectedRows);
                        }
                      : undefined
                  }
                  onRestore={
                    canWrite && archivedView
                      ? () => {
                          archiving.restore(selectedRows);
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
            <div
              ref={tableRef}
              role="table"
              tabIndex={-1}
              aria-label={t('columns.table')}
              aria-busy={stale}
              className="outline-none"
            >
              <PatientsTableHead
                query={query}
                onSort={(column) => {
                  setQuery(withFilter(query, sortPatch(query, column)));
                }}
                canSortBalance={canPay}
                selection={pageSelection}
                selectable={rows.length > 0 && !stale}
                onToggleAll={() => {
                  setSelected(
                    pageSelection === 'all' ? NO_SELECTION : new Set(rows.map((row) => row.id)),
                  );
                }}
              />
              <PatientsTableBody
                list={list}
                query={query}
                steppingBack={steppingBack}
                newPatient={newPatient}
                onClearFilters={() => {
                  setQuery(clearFilters(query));
                }}
                renderRow={(patient) => (
                  <PatientRow
                    key={patient.id}
                    patient={patient}
                    context={context}
                    balances={data.balanceById.get(patient.id)}
                    balanceLoading={data.balancesLoading}
                    selected={selected.has(patient.id)}
                    highlighted={panel !== null && 'id' in panel && panel.id === patient.id}
                    stale={stale}
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
                        twin={data.twins.get(patient.id)}
                        canWrite={canWrite}
                        disabled={stale}
                        busy={archiving.busy}
                        onPanel={openPanel}
                        onArchive={() => {
                          archiving.archive([patient]);
                        }}
                        onRestore={() => {
                          archiving.restore([patient]);
                        }}
                      />
                    }
                  />
                )}
              />
            </div>
          </TableCard>
        </Page>
      </div>
      {panel &&
        renderPanel?.(panel, {
          close: () => {
            openPanel(null);
          },
          open: openPanel,
        })}
    </div>
  );
}
