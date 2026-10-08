import type { Patient, PatientChart, ToothCode, ToothPresenceState } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-context';
import { Select } from '@/components/ui/field';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { practitionersQuery } from '@/features/users/users-api';
import { ChartLegend } from '../chart/chart-legend';
import { DentalChart } from '../chart/dental-chart';
import { FittedChart } from '../chart/fitted-chart';
import { ToothHistoryDialog } from '../dialogs/tooth-history-dialog';
import { PresenceDialog } from '../presence/presence-dialog';
import { chartQuery } from '../visits-api';
import { CatalogDrawer } from '../workspace/catalog-drawer';
import { ChartCard, ChartCardFrame } from '../workspace/chart-card';
import { ChartingActionsContext, type DrawerMode } from '../workspace/charting-actions';
import { DentitionSelect } from '../workspace/dentition-select';
import { PlanBoard } from '../workspace/plan-board';
import { UnfinishedCard } from '../workspace/unfinished-card';
import { useChartExpansion } from '../workspace/use-chart-expansion';
import { ToothPanel } from '../workspace/tooth-panel/tooth-panel';
import { ToothSelectionContext, useToothSelectionState } from '../workspace/tooth-selection';
import { useChartStage } from '../workspace/use-chart-stage';
import { usePatientChartingActions } from './patient-charting-actions';
import {
  paintTooth,
  type PresenceEdit,
  startPresenceEdit,
  withPendingPresence,
} from './presence-edit';
import { PresenceEditToolbar } from './presence-edit-toolbar';

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
  const expansion = useChartExpansion();

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
        expandedAside={<ChartLegend showToday={false} layout="key" />}
        expansion={expansion}
      >
        <FittedChart
          expanded={expansion.expanded}
          dentition={stage ?? chart.data.dentition.stage}
          withAreas={false}
        >
          {(size) => (
            <DentalChart
              teeth={teeth}
              dentition={stage ?? chart.data.dentition.stage}
              size={size}
              selected={historyTooth}
              onToothClick={setHistoryTooth}
            />
          )}
        </FittedChart>
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
 * record or remove a diagnosis, plan, cancel or remove a plan, manage named plans, and say what
 * is at a tooth position (feature 7). A caller who isn't a dentist first chooses the dentist the
 * records are for (P4).
 *
 * **Edit presence** turns the chart into a marking surface for a patient with several gaps or
 * implants: a brush from the floating toolbar, a click per tooth, and **Done** asks once when,
 * why and for which dentist for the whole batch. Cancel and Escape leave the mode, after a
 * discard prompt when anything was marked.
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
  const { t } = useTranslation(['clinical', 'common']);
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

  const expansion = useChartExpansion();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<PresenceEdit | null>(null);
  // Done was pressed: the batch's When / Reason / Dentist dialog is open.
  const [savingEdit, setSavingEdit] = useState(false);
  const shownTeeth = useMemo(
    () => (edit ? withPendingPresence(teeth, edit.changes) : teeth),
    [teeth, edit],
  );
  const leaveEdit = () => {
    if (!edit || edit.changes.size === 0) {
      setEdit(null);
      return;
    }
    confirm({
      title: t('common:discardTitle'),
      body: t('common:discardBody'),
      okLabel: t('common:discardLeave'),
      cancelLabel: t('common:keepEditing'),
      tone: 'warn',
      onConfirm: () => {
        setEdit(null);
      },
    });
  };
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || savingEdit) return;
    event.preventDefault();
    leaveEdit();
  });
  const editing = edit !== null;
  useEffect(() => {
    if (!editing) return undefined;
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('keydown', onEscape);
    };
  }, [editing]);
  const mark = (code: ToothCode) => {
    const recorded: ToothPresenceState = teeth.get(code)?.presence ?? 'present';
    setEdit((current) => current && paintTooth(current, code, recorded));
  };

  const chartCard = (
    <ChartCard
      teeth={shownTeeth}
      patient={patient}
      stage={stage ?? chart.dentition.stage}
      onStageChange={setStage}
      canWrite={canWrite}
      showToday={false}
      onMark={edit ? mark : undefined}
      expansion={expansion}
      action={
        edit === null && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // The marks go on the chart, not on a selected tooth.
              selection.select(null);
              setEdit(startPresenceEdit());
            }}
          >
            {t('presence.edit.start')}
          </Button>
        )
      }
      footer={
        edit && (
          <>
            <p className="sr-only" role="status">
              {t('presence.edit.active', {
                state: t(`presence.states.${edit.brush}`).toLocaleLowerCase(),
              })}
            </p>
            <PresenceEditToolbar
              brush={edit.brush}
              count={edit.changes.size}
              onBrush={(brush) => {
                setEdit((current) => current && { ...current, brush });
              }}
              onDone={() => {
                setSavingEdit(true);
              }}
              onCancel={leaveEdit}
            />
          </>
        )
      }
    />
  );

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
        <div className="flex flex-wrap items-start gap-x-4">
          {/* Expanded, the chart card leaves its column for a row of its own across the page. */}
          {expansion.expanded && <div className="min-w-0 basis-full">{chartCard}</div>}
          <div className="min-w-0 flex-[1_1_600px]">
            {!expansion.expanded && chartCard}
            <UnfinishedCard chart={chart} canWrite />
            <PlanBoard chart={chart} canWrite groups={actions.groups} />
          </div>
          <aside aria-label={t('workspace.toothPanel')} className="mb-4 min-w-0 flex-[1_1_340px]">
            <ToothPanel
              patientId={patient.id}
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
        {edit && savingEdit && (
          <PresenceDialog
            title={t('presence.popover.titleMany', { count: edit.changes.size })}
            onSave={async (details) => {
              await actions.setPresence(
                [...edit.changes].map(([toothCode, presence]) => ({ toothCode, presence })),
                details,
              );
              setEdit(null);
            }}
            onClose={() => {
              setSavingEdit(false);
            }}
          />
        )}
      </ChartingActionsContext.Provider>
    </ToothSelectionContext.Provider>
  );
}
