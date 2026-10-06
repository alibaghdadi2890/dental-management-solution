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
import { useStaffNames } from '@/features/users/use-staff-names';
import { ApiError } from '@/lib/api';
import { useChartSettings } from '../chart/use-chart-settings';
import { ToothHistoryDialog } from '../dialogs/tooth-history-dialog';
import { UnfinishedDialog } from '../dialogs/unfinished-dialog';
import { VisitSummaryDialog } from '../dialogs/visit-summary-dialog';
import { useDropOrphanedGroups } from '../save-groups-context';
import { SaveGroupsProvider } from '../save-groups-provider';
import { useVisit } from '../use-visit';
import { chartQuery } from '../visits-api';
import { CatalogDrawer } from './catalog-drawer';
import { ChartCard, ChartCardFrame } from './chart-card';
import {
  ChartingActionsContext,
  type DrawerMode,
  SERVICE_PRICE_PREFIX,
  servicePriceKey,
  useChartingActionsState,
} from './charting-actions';
import { FinancialBar } from './financial-bar';
import { NotesCard } from './notes-card';
import { PlanBoard } from './plan-board';
import { TodaysServices } from './todays-services';
import { unfinishedWork } from './unfinished';
import { ToothPanel } from './tooth-panel/tooth-panel';
import { ToothSelectionContext, useToothSelectionState } from './tooth-selection';
import { useChartKeyboard } from './use-chart-keyboard';
import { useChartStage } from './use-chart-stage';
import { VisitHeader } from './visit-header';
import { useToothParam } from './workspace-search';

type Tenant = NonNullable<Session['tenant']>;

/** The `/visits/$visitId` route: one workspace per visit, so its autosave groups (V6) never
 * carry over from one visit to the next. `tooth` is `?tooth=`, the tooth to select on arrival. */
export function VisitWorkspaceScreen({
  visitId,
  tooth,
}: {
  visitId: string;
  tooth?: ToothCode | undefined;
}) {
  return (
    <SaveGroupsProvider key={visitId}>
      <VisitWorkspacePage visitId={visitId} tooth={tooth} />
    </SaveGroupsProvider>
  );
}

/**
 * The visit workspace (spec §Screens 4 & 5): loads the live visit; an unknown or discarded id
 * (404) reads "Visit not found", any other failure offers Try again. A visit that is no longer
 * live — completed, or discarded from this page — goes to the patient's record, and so does one
 * that turns 404 on a refetch (discarded elsewhere, W6): nothing is charted into a dead visit.
 * A visit completed here (the summary dialog's Complete) lands on the record with its
 * post-visit summary (W16, `HistoryState.postVisit`); this redirect is the only navigation after
 * Complete. One completed by someone else while open here stays, read-only, with a banner naming
 * who completed it and when (4b). One opened already finished just shows the record.
 */
function VisitWorkspacePage({ visitId, tooth }: { visitId: string; tooth: ToothCode | undefined }) {
  const { t } = useTranslation(['clinical', 'common']);
  const { data: session } = useSession();
  const visit = useVisit(visitId);
  const [seenLive, setSeenLive] = useState(false);
  const live = visit.data?.status === 'in_progress' || visit.data?.status === 'paused';
  if (live && !seenLive) setSeenLive(true);

  if (!session?.tenant) return null;
  const notFound = visit.error instanceof ApiError && visit.error.status === 404;
  // Completed by someone else while open here: the workspace stays, read-only, and says so.
  const completedElsewhere =
    seenLive &&
    !notFound &&
    visit.data?.status === 'completed' &&
    visit.data.completedBy !== session.user.id;
  if (visit.data && (notFound || !live) && !completedElsewhere) {
    const completedHere = seenLive && !notFound && visit.data.status === 'completed';
    return (
      <Navigate
        to="/patients/$patientId"
        params={{ patientId: visit.data.patientId }}
        replace
        {...(completedHere ? { state: { postVisit: visit.data.id } } : {})}
      />
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
  return <Workspace visit={visit.data} tenant={session.tenant} tooth={tooth} />;
}

/**
 * The three bands in a full-height column: the header; the body, a wrapping row of the left
 * region (`1 1 600px`: the chart card, today's services, the treatment plan and the notes) and the
 * selected-tooth aside (`1 1 340px`), so the aside reflows under the chart below ~1000px; and the
 * financial bar. Read-only without `visit:write`
 * (W18). The tooth selection, the catalog drawer and the charting actions live here, shared with
 * the chart, the tooth panel and the drawer; the drawer opens over a scrim. `?tooth=` selects
 * its tooth (the tooth history's "Chart it in this visit"), then leaves the URL. The tooth
 * panel's "Full tooth history →" opens the tooth history dialog, and the financial bar's
 * **Review & complete** the visit summary. A visit of a patient with unfinished services opens
 * with the question which of them it continues (`UnfinishedDialog`). The price groups of services no longer on the visit
 * (removed by someone else) are dropped as the visit refreshes.
 */
function Workspace({
  visit,
  tenant,
  tooth,
}: {
  visit: Visit;
  tenant: Tenant;
  tooth: ToothCode | undefined;
}) {
  const { t, i18n } = useTranslation('clinical');
  // A visit completed elsewhere while open here is shown read-only (4b).
  const live = visit.status === 'in_progress' || visit.status === 'paused';
  const canWrite = usePermission('visit:write') && live;
  const { names } = useStaffNames();
  const patient = useQuery(patientQuery(visit.patientId));
  const chart = useQuery(chartQuery(visit.patientId));
  const selection = useToothSelectionState();
  const { orientation } = useChartSettings();
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const closeDrawer = useCallback(() => {
    setDrawer(null);
  }, []);
  const [historyTooth, setHistoryTooth] = useState<ToothCode | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const review = useCallback(() => {
    setReviewing(true);
  }, []);
  const closeReview = useCallback(() => {
    setReviewing(false);
  }, []);
  const actions = useChartingActionsState({ visit, selection, openDrawer: setDrawer });
  const teeth = useVisitTeeth(chart.data, visit);
  // What the visit is asked about as it opens, until it has answered (unfinished spec U5).
  const toAsk =
    canWrite && visit.unfinishedAnsweredAt === null && chart.data
      ? unfinishedWork(chart.data.plans, visit.id).toContinue
      : [];
  // Today's services that aren't on a tooth, per jaw and for the whole mouth.
  const areaCounts = useMemo(() => {
    const counts = { upper: 0, lower: 0, mouth: 0 };
    for (const service of visit.services) {
      if (service.toothCode === null) counts[service.jaw ?? 'mouth'] += 1;
    }
    return counts;
  }, [visit.services]);
  useDropOrphanedGroups(
    SERVICE_PRICE_PREFIX,
    visit.services.map((service) => servicePriceKey(service.id)),
  );

  // The patient's own switch answers at once after a change, without waiting for the chart.
  const patientStage =
    chart.data &&
    (patient.data
      ? effectiveDentition(chart.data.dentition.ageYears, patient.data.dentitionOverride)
      : chart.data.dentition
    ).stage;
  const [stage, setStage] = useChartStage(patientStage, selection.tooth);

  useToothParam({
    tooth,
    visitId: visit.id,
    ready: chart.data !== undefined,
    onSelect: selection.select,
  });

  useChartKeyboard({
    orientation,
    dentition: stage ?? 'permanent',
    selected: selection.tooth,
    areaSelected: selection.area !== null,
    onSelect: selection.select,
    // The summary dialog handles its own keys; while it is open the chart takes none.
    onEscape: drawer !== null ? closeDrawer : reviewing ? closeReview : undefined,
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
          {visit.status === 'completed' && visit.completedAt !== null && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 border-b border-primary-tint-border bg-primary-tint px-5 py-2.5 text-[13px] text-primary"
            >
              <span>
                {t('workspace.completedElsewhere', {
                  name:
                    (visit.completedBy && names.get(visit.completedBy)) ||
                    t('workspace.someoneElse'),
                  time: new Intl.DateTimeFormat(
                    i18n.resolvedLanguage === 'en' ? 'en-GB' : i18n.resolvedLanguage,
                    {
                      hour: '2-digit',
                      minute: '2-digit',
                      hourCycle: 'h23',
                      timeZone: tenant.timeZone,
                    },
                  ).format(new Date(visit.completedAt)),
                })}
              </span>
              <Link
                to="/patients/$patientId"
                params={{ patientId: visit.patientId }}
                state={{ postVisit: visit.id }}
                className="font-medium underline"
              >
                {t('workspace.viewSummary')}
              </Link>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-wrap items-stretch overflow-auto">
            <div className="min-w-0 flex-[1_1_600px] px-5 pt-[18px] pb-5">
              {chart.data && patient.data && stage ? (
                <ChartCard
                  teeth={teeth}
                  patient={patient.data}
                  stage={stage}
                  onStageChange={setStage}
                  canWrite={canWrite}
                  areaCounts={areaCounts}
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
              <TodaysServices visit={visit} chart={chart.data} canWrite={canWrite} />
              {chart.data && <PlanBoard chart={chart.data} canWrite={canWrite} />}
              <NotesCard visit={visit} canWrite={canWrite} />
            </div>
            <aside
              aria-label={t('workspace.toothPanel')}
              className="min-w-0 flex-[1_1_340px] border-s border-border bg-surface p-4"
            >
              {chart.data ? (
                <ToothPanel
                  visit={visit}
                  chart={chart.data}
                  teeth={teeth}
                  canWrite={canWrite}
                  timeZone={tenant.timeZone}
                  onOpenDrawer={setDrawer}
                  onOpenHistory={setHistoryTooth}
                />
              ) : (
                !chart.error && <CardSkeleton label={t('workspace.loading')} />
              )}
            </aside>
          </div>
          <FinancialBar visit={visit} canWrite={canWrite} onReview={review} />
          <VisitSummaryDialog
            visit={visit}
            chart={chart.data}
            open={reviewing && canWrite}
            onClose={closeReview}
          />
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
          {toAsk.length > 0 && <UnfinishedDialog visitId={visit.id} plans={toAsk} />}
          <ToothHistoryDialog
            patientId={visit.patientId}
            patientName={patient.data?.fullName}
            code={historyTooth}
            onCodeChange={setHistoryTooth}
            canStart={false}
            onChartIt={selection.select}
          />
        </div>
      </ChartingActionsContext.Provider>
    </ToothSelectionContext.Provider>
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
