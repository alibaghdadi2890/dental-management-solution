import type { Patient, PatientChart, ToothCode } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { practitionersQuery } from '@/features/users/users-api';
import { ChartLegend } from '../chart/chart-legend';
import { DentalChart } from '../chart/dental-chart';
import { ToothHistoryDialog } from '../dialogs/tooth-history-dialog';
import { chartQuery } from '../visits-api';
import { CatalogDrawer } from '../workspace/catalog-drawer';
import { ChartCard, ChartCardFrame } from '../workspace/chart-card';
import { ChartingActionsContext, type DrawerMode } from '../workspace/charting-actions';
import { DentitionSelect } from '../workspace/dentition-select';
import { PlanBoard } from '../workspace/plan-board';
import { UnfinishedCard } from '../workspace/unfinished-card';
import { ToothPanel } from '../workspace/tooth-panel/tooth-panel';
import { ToothSelectionContext, useToothSelectionState } from '../workspace/tooth-selection';
import { useChartStage } from '../workspace/use-chart-stage';
import { usePatientChartingActions } from './patient-charting-actions';

/**
 * The record's Dental chart tab (4b, L5, D17; ADR-0031). With `chart:write` on a patient that
 * isn't archived it is where a dentist records diagnoses and plans treatment without a visit
 * (`ChartEditor`). Otherwise it is the full chart at 12px cells, read-only, with the legend (no
 * "Treated today") and the chart toggle; clicking a tooth opens its history, which offers to
 * chart it in the live visit or start one.
 */
export function ChartTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation('visits');
  const canWrite = usePermission('visit:write');
  const canChart = usePermission('chart:write') && patient.archivedAt === null;
  const chart = useQuery(chartQuery(patient.id));
  const teeth = useMemo(
    () => new Map((chart.data?.teeth ?? []).map((tooth) => [tooth.code, tooth])),
    [chart.data],
  );
  const [historyTooth, setHistoryTooth] = useState<ToothCode | null>(null);
  const [stage, setStage] = useChartStage(chart.data?.dentition.stage, null);

  if (!chart.data) {
    return chart.isError ? (
      <p role="alert" className="text-[12.5px] text-ink-muted">
        {t('chartTab.failed')}
      </p>
    ) : (
      <CardSkeleton label={t('chartTab.loading')} />
    );
  }
  if (canChart) return <ChartEditor patient={patient} chart={chart.data} canWrite={canWrite} />;
  return (
    <>
      <ChartCardFrame
        subtitle={
          <DentitionSelect
            patient={patient}
            stage={stage ?? chart.data.dentition.stage}
            canWrite={canWrite}
            onChange={setStage}
          />
        }
        aside={<ChartLegend showToday={false} />}
      >
        <DentalChart
          teeth={teeth}
          dentition={stage ?? chart.data.dentition.stage}
          size={12}
          selected={historyTooth}
          onToothClick={setHistoryTooth}
        />
      </ChartCardFrame>
      <ToothHistoryDialog
        patientId={patient.id}
        patientName={patient.fullName}
        code={historyTooth}
        onCodeChange={setHistoryTooth}
        canStart={patient.archivedAt === null}
      />
    </>
  );
}

/**
 * Charting on the patient record: the workspace's chart, tooth panel, jaws card, plan board and
 * drawer, driven by the patient-bound `ChartingActions` — so only what needs no visit is offered:
 * record or remove a diagnosis, plan, cancel or remove a plan, and manage named plans. A caller
 * who isn't a dentist first chooses the dentist the records are for (P4).
 */
function ChartEditor({
  patient,
  chart,
  canWrite,
}: {
  patient: Patient;
  chart: PatientChart;
  /** `visit:write`: the dentition selector's own permission. */
  canWrite: boolean;
}) {
  const { t } = useTranslation('clinical');
  const { data: session } = useSession();
  const practitioners = useQuery(practitionersQuery());
  const dentistFieldId = useId();
  const selection = useToothSelectionState();
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [chosenDentist, setChosenDentist] = useState('');
  const [historyTooth, setHistoryTooth] = useState<ToothCode | null>(null);
  const closeDrawer = useCallback(() => {
    setDrawer(null);
  }, []);

  const callerIsDentist =
    practitioners.data?.some((dentist) => dentist.userId === session?.user.id) ?? true;
  const actions = usePatientChartingActions({
    patientId: patient.id,
    dentistId: callerIsDentist ? undefined : chosenDentist || undefined,
    selection,
    openDrawer: setDrawer,
  });
  const teeth = useMemo(() => new Map(chart.teeth.map((tooth) => [tooth.code, tooth])), [chart]);
  const timeZone = session?.tenant?.timeZone ?? 'UTC';
  const [stage, setStage] = useChartStage(chart.dentition.stage, selection.tooth);

  return (
    <ToothSelectionContext.Provider value={selection}>
      <ChartingActionsContext.Provider value={actions}>
        <div className="mb-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 empty:hidden">
          {!callerIsDentist && (
            <div className="flex items-center gap-2">
              <label htmlFor={dentistFieldId} className="text-[12.5px] leading-none font-medium">
                {t('recordChart.dentist')}
              </label>
              <Select
                id={dentistFieldId}
                className="h-8 w-[200px]"
                value={chosenDentist}
                onChange={(event) => {
                  setChosenDentist(event.target.value);
                }}
              >
                <option value="">{t('recordChart.chooseDentist')}</option>
                {practitioners.data?.map((dentist) => (
                  <option key={dentist.id} value={dentist.id}>
                    {dentist.displayName}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        {chart.liveVisitId !== null && (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary-tint-border bg-primary-tint px-3.5 py-2.5 text-[12.5px] text-primary"
          >
            <span>{t('recordChart.liveVisit')}</span>
            <Link
              to="/visits/$visitId"
              params={{ visitId: chart.liveVisitId }}
              className="font-medium underline"
            >
              {t('recordChart.openVisit')}
            </Link>
          </div>
        )}
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-[1_1_600px]">
            <ChartCard
              teeth={teeth}
              patient={patient}
              stage={stage ?? chart.dentition.stage}
              onStageChange={setStage}
              canWrite={canWrite}
              showToday={false}
            />
            <UnfinishedCard chart={chart} canWrite />
            <PlanBoard chart={chart} canWrite groups={actions.groups} />
          </div>
          <aside aria-label={t('workspace.toothPanel')} className="min-w-0 flex-[1_1_340px]">
            <ToothPanel
              visit={null}
              chart={chart}
              teeth={teeth}
              canWrite
              timeZone={timeZone}
              onOpenDrawer={setDrawer}
              onOpenHistory={setHistoryTooth}
            />
          </aside>
        </div>
        {drawer !== null && (
          <>
            <div
              aria-hidden
              onClick={closeDrawer}
              className="fixed inset-0 z-30 animate-fadein bg-[rgba(27,26,31,.28)]"
            />
            <CatalogDrawer key={drawer} mode={drawer} floating onClose={closeDrawer} />
          </>
        )}
        <ToothHistoryDialog
          patientId={patient.id}
          patientName={patient.fullName}
          code={historyTooth}
          onCodeChange={setHistoryTooth}
          canStart
        />
      </ChartingActionsContext.Provider>
    </ToothSelectionContext.Provider>
  );
}
