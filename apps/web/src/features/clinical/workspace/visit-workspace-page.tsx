import {
  deriveChart,
  type DiagnosisRecord,
  effectiveDentition,
  hasStep,
  isOptionalStep,
  type Jaw,
  type PatientChart,
  type Session,
  type ToothCode,
  type ToothState,
  type TreatmentPlan,
  type Visit,
  type VisitStep,
  type VisitType,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { EvidenceStrip } from '@/features/files/evidence-strip';
import { FileDropSurface } from '@/features/files/file-drop-surface';
import { VisitFilesStrip } from '@/features/files/file-rows';
import { patientQuery } from '@/features/patients/patients-api';
import { useStaffNames } from '@/features/users/use-staff-names';
import { practitionersQuery } from '@/features/users/users-api';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useChartMarks } from '../chart/use-chart-marks';
import { useChartSettings } from '../chart/use-chart-settings';
import { ToothHistoryDialog } from '../dialogs/tooth-history-dialog';
import { type DiagnosisToResolve, diagnosesToResolve } from '../dialogs/diagnoses-to-resolve';
import { ResolveBeforeCompleteDialog } from '../dialogs/resolve-before-complete-dialog';
import { VisitSummaryDialog } from '../dialogs/visit-summary-dialog';
import { FlowFooter } from '../flow/flow-footer';
import { LastHygieneLine } from '../flow/last-hygiene-line';
import { PlannedToday } from '../flow/planned-today';
import { CompleteStep } from '../flow/steps/complete-step';
import { ComplaintStep } from '../flow/steps/complaint-step';
import { FindingsStep } from '../flow/steps/findings-step';
import { IntakeStep } from '../flow/steps/intake-step';
import { PlanStep } from '../flow/steps/plan-step';
import { TodayStep } from '../flow/steps/today-step';
import { useCarriedDiagnoses } from '../flow/use-carried-diagnoses';
import { useVisitFlow } from '../flow/use-visit-flow';
import { VisitStepper } from '../flow/visit-stepper';
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
import { ToothPanel } from './tooth-panel/tooth-panel';
import { ToothSelectionContext, useToothSelectionState } from './tooth-selection';
import { useChartExpansion } from './use-chart-expansion';
import { useChartKeyboard } from './use-chart-keyboard';
import { useChartStage } from './use-chart-stage';
import { VisitHeader } from './visit-header';
import { useToothParam } from './workspace-search';

type Tenant = NonNullable<Session['tenant']>;

/** The types whose examination starts from the images: their Evidence strip opens by itself. */
const EVIDENCE_FIRST: ReadonlySet<VisitType> = new Set([
  'examination',
  'emergency',
  'consultation',
]);

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
 * The bands of a full-height column: the header, the stepper (feature 10), the body and a
 * footer. The visit's flow (`useVisitFlow`, ADR-0044) decides the body:
 *
 * - **All** — the whole workspace, as before the flows: a wrapping row of the left region
 *   (`1 1 600px`: the chart card, today's services, the treatment plan, the files strip and the
 *   notes) and the selected-tooth aside (`1 1 340px`), so the aside reflows under the chart below
 *   ~1000px; the footer is the financial bar.
 * - **Steps** — only what the step is for. Examine and Perform keep the chart and the tooth
 *   panel (in findings mode for Examine) with their own cards on the left; Intake, Complaint,
 *   Findings, Plan, Today's work and Complete take the whole body. The footer moves between the
 *   steps and ends on **Complete visit**.
 *
 * Read-only without `visit:write`
 * (W18). The tooth selection, the catalog drawer and the charting actions live here, shared with
 * the chart, the tooth panel and the drawer; the drawer opens over a scrim. `?tooth=` selects
 * its tooth (the tooth history's "Chart it in this visit"), then leaves the URL. Add service is
 * offered at the top of the tooth panel, on Today's services and with the `S` key. The tooth
 * panel's "Full tooth history →" opens the tooth history dialog, and the financial bar's
 * **Review & complete** the visit summary. The price groups of services no longer on the visit
 * (removed by someone else) are dropped as the visit refreshes. A file dropped anywhere on the
 * workspace, or an image pasted, opens the upload panel with the visit — and the selected
 * tooth — pre-filled (`FileDropSurface`).
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
  const addService = useCallback(() => {
    setDrawer('service');
  }, []);
  const [historyTooth, setHistoryTooth] = useState<ToothCode | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const review = useCallback(() => {
    setReviewing(true);
  }, []);
  const closeReview = useCallback(() => {
    setReviewing(false);
  }, []);
  const visitFlow = useVisitFlow(visit, chart.data);
  // Entering the Complete step first asks about the diagnoses still open on teeth treated today
  // (the stepper and the footer go through this `goTo`); those shown are not asked about again,
  // here or in the Visit Summary.
  const [checking, setChecking] = useState<{
    from: VisitStep;
    items: DiagnosisToResolve[];
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set());
  const { goTo: flowGoTo, current: currentStep } = visitFlow;
  const onComplete = visitFlow.view === 'steps' && currentStep === 'complete';
  const guardedGoTo = useCallback(
    (next: VisitStep) => {
      if (next === 'complete' && !onComplete && canWrite && chart.data) {
        const open = diagnosesToResolve(visit, chart.data).filter(
          (item) => !acknowledged.has(item.record.id),
        );
        if (open.length > 0) {
          setChecking({ from: currentStep, items: open });
          return;
        }
      }
      flowGoTo(next);
    },
    [onComplete, canWrite, chart.data, visit, acknowledged, currentStep, flowGoTo],
  );
  const flow = useMemo(() => ({ ...visitFlow, goTo: guardedGoTo }), [visitFlow, guardedGoTo]);
  const { select, selectArea, area: selectedArea } = selection;
  /** Selects where a record is: its tooth, or its jaw or the whole mouth. */
  const focusTarget = useCallback(
    (record: { toothCode: ToothCode | null; jaw?: Jaw | null }) => {
      if (record.toothCode !== null) {
        select(record.toothCode);
        return;
      }
      const area = record.jaw ?? 'mouth';
      // Selecting the selected area again would deselect it.
      if (selectedArea !== area) selectArea(area);
    },
    [select, selectArea, selectedArea],
  );
  const { carried, carry } = useCarriedDiagnoses(visit.id);
  // The diagnosis the Plan step was opened for: its card takes the focus.
  const [planFocus, setPlanFocus] = useState<string | null>(null);
  const { goTo, view } = flow;
  const planDiagnosis = useCallback(
    (record: DiagnosisRecord) => {
      if (record.recordedInVisitId !== visit.id) carry(record.id);
      setPlanFocus(record.id);
      goTo('plan');
    },
    [visit.id, carry, goTo],
  );
  // The diagnosis toast's Plan treatment: on to the Plan step where the visit shows one.
  const hasPlanStep = hasStep(visit.type, 'plan');
  const onPlanDiagnosis = useCallback(
    (record: DiagnosisRecord) => {
      if (view !== 'steps' || !hasPlanStep) return false;
      planDiagnosis(record);
      return true;
    },
    [view, hasPlanStep, planDiagnosis],
  );
  const actions = useChartingActionsState({
    visit,
    selection,
    openDrawer: setDrawer,
    onPlanDiagnosis,
  });
  const startWork = useCallback(
    (plan: TreatmentPlan) => {
      goTo('perform');
      focusTarget(plan);
    },
    [goTo, focusTarget],
  );
  const examineTooth = useCallback(
    (record: DiagnosisRecord) => {
      goTo('examine');
      focusTarget(record);
    },
    [goTo, focusTarget],
  );
  const addUnplanned = useCallback(() => {
    goTo('perform');
    setDrawer('service');
  }, [goTo]);
  /** The step whose layout shows; none in the All view. */
  const step = flow.view === 'all' ? null : flow.current;
  // The steps that keep the chart and the tooth panel.
  const charting = step === null || step === 'examine' || step === 'perform';
  const teeth = useVisitTeeth(chart.data, visit);
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
    // `S` adds a service where the chart is on screen.
    onAddService: canWrite && charting ? addService : undefined,
  });

  const expansion = useChartExpansion();
  const chartCard =
    chart.data && patient.data && stage ? (
      <ChartCard
        teeth={teeth}
        patient={patient.data}
        stage={stage}
        onStageChange={setStage}
        canWrite={canWrite}
        areaCounts={areaCounts}
        expansion={expansion}
      />
    ) : null;

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
          <VisitStepper flow={flow} />
          {step === 'intake' && (
            <IntakeStep
              visit={visit}
              patient={patient.data}
              chart={chart.data}
              canWrite={canWrite}
            />
          )}
          {step === 'complaint' && <ComplaintStep visit={visit} canWrite={canWrite} />}
          {step === 'findings' && (
            <FindingsStep
              visit={visit}
              chart={chart.data}
              canWrite={canWrite}
              carried={carried}
              onPlan={planDiagnosis}
              onTooth={examineTooth}
            />
          )}
          {step === 'plan' && (
            <PlanStep
              visit={visit}
              chart={chart.data}
              canWrite={canWrite}
              carried={carried}
              focusId={planFocus}
            />
          )}
          {step === 'today' && (
            <TodayStep
              visit={visit}
              chart={chart.data}
              canWrite={canWrite}
              onStart={startWork}
              onAddUnplanned={addUnplanned}
            />
          )}
          {step === 'complete' && (
            <CompleteStep
              visit={visit}
              chart={chart.data}
              canWrite={canWrite}
              onAddService={addService}
            />
          )}
          {charting && (
            <div
              data-step={step ?? 'all'}
              className="flex min-h-0 flex-1 flex-wrap items-stretch overflow-auto"
            >
              {/* Expanded, the chart card leaves its column for a row of its own across the page;
                the services, the plans and the tooth panel follow under it. */}
              {expansion.expanded && chartCard && (
                <div className="min-w-0 basis-full px-5 pt-[18px]">{chartCard}</div>
              )}
              <div
                className={cn(
                  'min-w-0 flex-[1_1_600px] px-5 pb-5',
                  !(expansion.expanded && chartCard) && 'pt-[18px]',
                )}
              >
                {step === 'perform' && visit.type === 'hygiene' && (
                  <LastHygieneLine patientId={visit.patientId} />
                )}
                {step !== null && (
                  <EvidenceStrip
                    // Each step decides where its strip starts.
                    key={step}
                    visit={visit}
                    selectedTooth={selection.tooth}
                    defaultOpen={step === 'examine' && EVIDENCE_FIRST.has(visit.type)}
                  />
                )}
                {chartCard ? (
                  !expansion.expanded && chartCard
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
                {step === 'perform' && (
                  <PlannedToday visit={visit} chart={chart.data} canWrite={canWrite} />
                )}
                {step !== 'examine' && (
                  <TodaysServices
                    visit={visit}
                    chart={chart.data}
                    canWrite={canWrite}
                    onAdd={addService}
                  />
                )}
                {/* Where Perform is optional, the plan is at hand for what is done on the spot. */}
                {(step === null || (step === 'perform' && isOptionalStep(visit.type, step))) &&
                  chart.data && <PlanBoard chart={chart.data} canWrite={canWrite} />}
                {step === null && (
                  <VisitFilesStrip
                    patient={patient.data}
                    visit={visit}
                    selectedTooth={selection.tooth}
                  />
                )}
                {step !== 'examine' && <NotesCard visit={visit} canWrite={canWrite} />}
              </div>
              <aside
                aria-label={t('workspace.toothPanel')}
                className={cn(
                  'min-w-0 flex-[1_1_340px] border-s border-border bg-surface p-4',
                  expansion.expanded && chartCard && 'rounded-ss-xl border-t',
                )}
              >
                {chart.data ? (
                  <ToothPanel
                    patientId={visit.patientId}
                    visit={visit}
                    chart={chart.data}
                    teeth={teeth}
                    canWrite={canWrite}
                    timeZone={tenant.timeZone}
                    onOpenDrawer={setDrawer}
                    onOpenHistory={setHistoryTooth}
                    mode={step === 'examine' ? 'findings' : 'full'}
                  />
                ) : (
                  !chart.error && <CardSkeleton label={t('workspace.loading')} />
                )}
              </aside>
            </div>
          )}
          {step === null ? (
            <FinancialBar visit={visit} canWrite={canWrite} onReview={review} />
          ) : (
            <FlowFooter flow={flow} canComplete={canWrite} onComplete={review} />
          )}
          <FileDropSurface
            patientId={visit.patientId}
            patientName={patient.data?.fullName}
            visit={visit}
            toothCode={selection.tooth}
          />
          <VisitSummaryDialog
            visit={visit}
            chart={chart.data}
            open={reviewing && canWrite}
            onClose={closeReview}
            acknowledged={acknowledged}
          />
          {checking && (
            <ResolveBeforeCompleteDialog
              visitId={visit.id}
              type={visit.type}
              from={checking.from}
              items={checking.items}
              onBack={() => {
                setChecking(null);
              }}
              onContinue={(shown) => {
                setAcknowledged((current) => new Set([...current, ...shown]));
                setChecking(null);
                flowGoTo('complete');
              }}
            />
          )}
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
 * added here marks its tooth at once, in its catalog colour (`useChartMarks`). Empty until the
 * chart loads. */
function useVisitTeeth(
  chart: PatientChart | undefined,
  visit: Visit,
): ReadonlyMap<ToothCode, ToothState> {
  const marks = useChartMarks(chart);
  const practitioners = useQuery(practitionersQuery()).data;
  const dentistName =
    practitioners?.find((dentist) => dentist.id === visit.dentistId)?.displayName ?? '';
  return useMemo(
    () =>
      chart
        ? deriveChart({
            diagnoses: chart.diagnoses,
            plans: chart.plans,
            history: chart.history,
            liveServices: visit.services,
            presence: chart.presence,
            marks,
            liveVisit: { date: visit.localDate, dentistName },
          })
        : new Map<ToothCode, ToothState>(),
    [chart, visit.services, visit.localDate, marks, dentistName],
  );
}
