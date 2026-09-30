import {
  deriveChart,
  effectiveDentition,
  type PatientChart,
  type Session,
  type ToothCode,
  type ToothState,
  type Visit,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { patientQuery } from '@/features/patients/patients-api';
import { ApiError } from '@/lib/api';
import { useChartSettings } from '../chart/use-chart-settings';
import { useFlushSaveGroups } from '../save-groups-context';
import { SaveGroupsProvider } from '../save-groups-provider';
import { useVisit } from '../use-visit';
import { chartQuery } from '../visits-api';
import { CatalogDrawer } from './catalog-drawer';
import { ChartCard, ChartCardFrame } from './chart-card';
import {
  ChartingActionsContext,
  type DrawerMode,
  useChartingActionsState,
} from './charting-actions';
import type { ResolvedDentition } from './dentition-select';
import { FinancialBar } from './financial-bar';
import { NotesCard } from './notes-card';
import { PlanBoard } from './plan-board';
import { ToothPanel } from './tooth-panel/tooth-panel';
import { ToothSelectionContext, useToothSelectionState } from './tooth-selection';
import { useChartKeyboard } from './use-chart-keyboard';
import { VisitHeader } from './visit-header';

type Tenant = NonNullable<Session['tenant']>;

/** No presence records yet (the chart is loading): one stable array, so the keyboard doesn't
 * resubscribe on every render. */
const NO_STATUS: never[] = [];

/** The `/visits/$visitId` route: one workspace per visit, so its autosave groups (V6) never
 * carry over from one visit to the next. */
export function VisitWorkspaceScreen({ visitId }: { visitId: string }) {
  return (
    <SaveGroupsProvider key={visitId}>
      <VisitWorkspacePage visitId={visitId} />
    </SaveGroupsProvider>
  );
}

/**
 * The visit workspace (spec §Screens 4 & 5): loads the live visit; an unknown or discarded id
 * (404) reads "Visit not found", any other failure offers Try again. A visit that is no longer
 * live — completed, or discarded from this page — goes to the patient's record, and so does one
 * that turns 404 on a refetch (discarded elsewhere, W6): nothing is charted into a dead visit.
 */
function VisitWorkspacePage({ visitId }: { visitId: string }) {
  const { t } = useTranslation(['clinical', 'common']);
  const { data: session } = useSession();
  const visit = useVisit(visitId);

  if (!session?.tenant) return null;
  const notFound = visit.error instanceof ApiError && visit.error.status === 404;
  if (
    visit.data &&
    (notFound || visit.data.status === 'completed' || visit.data.status === 'discarded')
  ) {
    return (
      <Navigate to="/patients/$patientId" params={{ patientId: visit.data.patientId }} replace />
    );
  }
  if (!visit.data) {
    if (visit.error === null) {
      return (
        <div className="p-[22px]">
          <CardSkeleton label={t('workspace.loading')} />
        </div>
      );
    }
    return (
      <div className="h-full overflow-auto p-[22px]">
        <section className="rounded-xl border border-border bg-surface">
          {notFound ? (
            <EmptyState
              title={t('workspace.notFoundTitle')}
              body={t('workspace.notFoundBody')}
              action={
                <Link
                  to="/patients"
                  className="inline-flex h-9 items-center rounded-lg border border-border-control bg-surface px-3.5 text-[12.5px] leading-none font-medium text-ink hover:border-primary hover:text-primary"
                >
                  {t('workspace.toPatients')}
                </Link>
              }
            />
          ) : (
            <ErrorState
              title={t('workspace.failedTitle')}
              body={t('workspace.failedBody')}
              requestId={visit.error instanceof ApiError ? visit.error.requestId : undefined}
              onRetry={() => void visit.refetch()}
            />
          )}
        </section>
      </div>
    );
  }
  return <Workspace visit={visit.data} tenant={session.tenant} />;
}

/**
 * The three bands in a full-height column: the header; the body, a wrapping row of the left
 * region (`1 1 600px`: the chart card, the treatment plan and the clinical notes) and the
 * selected-tooth aside (`1 1 340px`), so the aside reflows under the chart below ~1000px; and the
 * financial bar. Read-only without `visit:write`
 * (W18). The tooth selection, the catalog drawer and the charting actions live here, shared with
 * the chart, the tooth panel and the drawer; the drawer opens over a scrim.
 */
function Workspace({ visit, tenant }: { visit: Visit; tenant: Tenant }) {
  const { t } = useTranslation('clinical');
  const canWrite = usePermission('visit:write');
  const patient = useQuery(patientQuery(visit.patientId));
  const chart = useQuery(chartQuery(visit.patientId));
  const selection = useToothSelectionState();
  const { orientation } = useChartSettings();
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const closeDrawer = useCallback(() => {
    setDrawer(null);
  }, []);
  const actions = useChartingActionsState({ visit, selection, openDrawer: setDrawer });
  const teeth = useVisitTeeth(chart.data, visit);
  // Review & complete sends every unsaved edit first; the summary dialog opens from here (H1).
  const flush = useFlushSaveGroups();
  const review = useCallback(() => {
    void flush();
  }, [flush]);

  // The patient's own override answers at once after a change; the chart's age stays the
  // server's (the tenant's date), so the stage never waits for the chart refetch.
  const dentition: ResolvedDentition | undefined = chart.data && {
    ...(patient.data
      ? effectiveDentition(chart.data.dentition.ageYears, patient.data.dentitionOverride)
      : chart.data.dentition),
    ageYears: chart.data.dentition.ageYears,
  };

  useChartKeyboard({
    orientation,
    dentition: dentition?.stage ?? 'permanent',
    toothStatus: chart.data?.toothStatus ?? NO_STATUS,
    selected: selection.tooth,
    onSelect: selection.select,
    onEscape: drawer === null ? undefined : closeDrawer,
  });

  return (
    <ToothSelectionContext.Provider value={selection}>
      <ChartingActionsContext.Provider value={actions}>
        <div className="relative flex h-full flex-col">
          <VisitHeader
            visit={visit}
            patient={patient.data}
            chart={chart.data}
            tenant={tenant}
            canWrite={canWrite}
          />
          <div className="flex min-h-0 flex-1 flex-wrap items-stretch overflow-auto">
            <div className="min-w-0 flex-[1_1_600px] px-5 pt-[18px] pb-5">
              <TodayDivider />
              {chart.data && patient.data && dentition ? (
                <ChartCard
                  teeth={teeth}
                  chart={chart.data}
                  patient={patient.data}
                  dentition={dentition}
                  canWrite={canWrite}
                />
              ) : (
                <ChartCardFrame>
                  {chart.error || patient.error ? (
                    <ErrorState
                      title={t('workspace.chartFailed')}
                      body={t('workspace.failedBody')}
                      onRetry={() => {
                        void chart.refetch();
                        void patient.refetch();
                      }}
                    />
                  ) : (
                    <CardSkeleton label={t('workspace.loading')} />
                  )}
                </ChartCardFrame>
              )}
              {chart.data && <PlanBoard chart={chart.data} canWrite={canWrite} />}
              <NotesCard visit={visit} canWrite={canWrite} />
            </div>
            <aside
              aria-label={t('workspace.toothPanel')}
              className="min-w-0 flex-[1_1_340px] border-s border-border bg-surface p-4"
            >
              {chart.data && dentition ? (
                <ToothPanel
                  visit={visit}
                  chart={chart.data}
                  teeth={teeth}
                  dentition={dentition.stage}
                  canWrite={canWrite}
                  timeZone={tenant.timeZone}
                  onOpenDrawer={setDrawer}
                />
              ) : (
                !chart.error && <CardSkeleton label={t('workspace.loading')} />
              )}
            </aside>
          </div>
          <FinancialBar visit={visit} canWrite={canWrite} onReview={review} />
          {drawer !== null && canWrite && (
            <>
              <div
                aria-hidden
                onClick={closeDrawer}
                className="absolute inset-0 z-20 animate-fadein bg-[rgba(27,26,31,.28)]"
              />
              <CatalogDrawer key={drawer} mode={drawer} onClose={closeDrawer} />
            </>
          )}
        </div>
      </ChartingActionsContext.Provider>
    </ToothSelectionContext.Provider>
  );
}

/** The POC's section divider above the chart card: "Today's visit" (micro label), "What you are
 * doing now", then a 1px rule filling the row. */
function TodayDivider() {
  const { t } = useTranslation('clinical');
  return (
    <div className="mb-[11px] flex flex-wrap items-center gap-[9px]">
      <span className="text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
        {t('workspace.today')}
      </span>
      <span className="text-[12.5px] leading-[1.3] text-ink-muted">{t('workspace.todayHint')}</span>
      <span aria-hidden className="h-px min-w-5 flex-1 bg-border" />
    </div>
  );
}

/** What the chart card and the tooth panel draw: the patient's records plus this visit's services
 * as they stand in the visit cache (`deriveChart`, the same derivation the API runs), so a service
 * added here marks its tooth at once. Empty until the chart loads. */
function useVisitTeeth(
  chart: PatientChart | undefined,
  visit: Visit,
): ReadonlyMap<ToothCode, ToothState> {
  return useMemo(
    () =>
      chart
        ? deriveChart({
            diagnoses: chart.diagnoses,
            plans: chart.plans,
            history: chart.history,
            liveServices: visit.services,
          })
        : new Map<ToothCode, ToothState>(),
    [chart, visit.services],
  );
}
