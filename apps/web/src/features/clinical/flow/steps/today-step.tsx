import {
  type PatientChart,
  type PlanPriority,
  type TreatmentPlan,
  type Visit,
} from '@dcm/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { useFileText } from '@/features/files/file-text';
import { CategoryIcon } from '@/features/files/file-tile';
import { patientFilesQuery } from '@/features/files/files-api';
import { useFiles } from '@/features/files/files-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useVisitMutations } from '../../visit-mutations';
import { plansTotal } from '../../workspace/tooth-panel/tooth-records';
import { useSessionLabel } from '../flow-labels';
import { EMPTY_LINE, STEP_BODY } from '../flow-styles';
import { SessionChip } from '../priority-chip';
import { useTargetLabel } from '../use-target-label';
import { sessionNumberIn } from '../visit-facts';
import { type PlanRow, todayPhases, worklistItems } from '../worklist';

/** Each phase's rule and label, in its tone. */
const TONE: Record<PlanPriority, { rule: string; label: string }> = {
  urgent: { rule: 'border-t-danger', label: 'text-danger' },
  high: { rule: 'border-t-warning', label: 'text-warning' },
  elective: { rule: 'border-t-ink-muted', label: 'text-ink-secondary' },
};

/**
 * **Today's work** (feature 10, V8; ADR-0048), the first step of a treatment visit: the
 * patient's treatment plan by priority, each treatment with a checkbox that puts it on this
 * visit's list for today. The visit starts with the work in progress and what is urgent ticked;
 * the dentist ticks and unticks the rest here, at any time. A row reads tooth, treatment, its
 * session when the work spans several, the diagnosis it treats and the image that was seen on,
 * and its price. A ticked row offers **Perform** (or **Continue**, for work in progress), which
 * goes to Perform with that tooth selected. The line at the top counts and totals what is
 * ticked. **Add unplanned work** opens the services drawer.
 */
export function TodayStep({
  visit,
  chart,
  canWrite,
  onStart,
  onAddUnplanned,
}: {
  visit: Visit;
  chart: PatientChart | undefined;
  canWrite: boolean;
  /** Perform / Continue: on to the Perform step, on this plan's tooth or level. */
  onStart: (plan: TreatmentPlan) => void;
  onAddUnplanned: () => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  if (chart === undefined) {
    return (
      <div data-step="today" className={STEP_BODY}>
        <section className="rounded-xl border border-border bg-surface px-[18px] py-4">
          <CardSkeleton label={t('workspace.loading')} />
        </section>
      </div>
    );
  }
  const phases = todayPhases(visit, chart);
  const today = worklistItems(visit, chart);
  const total = plansTotal(today.map((item) => item.plan));
  return (
    <div data-step="today" className={STEP_BODY}>
      <div className="flex flex-col gap-3">
        {phases.length > 0 && (
          <p
            role="status"
            data-today-summary
            className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-0.5 text-[13px] leading-[1.4]"
          >
            <span className="font-semibold">{t('flow.today.picked', { count: today.length })}</span>
            {total && (
              <span dir="ltr" className="font-mono font-semibold tabular-nums">
                {formatMoney(total, locale)}
              </span>
            )}
            {canWrite && <span className="text-ink-muted">{t('flow.today.hint')}</span>}
          </p>
        )}
        {phases.map((phase) => (
          <section
            key={phase.priority}
            aria-label={t(`flow.priority.${phase.priority}`)}
            data-phase={phase.priority}
            className={cn(
              'overflow-hidden rounded-xl border border-t-[3px] border-border bg-surface',
              TONE[phase.priority].rule,
            )}
          >
            <div className="flex items-baseline justify-between gap-3 px-[18px] py-3">
              <h2
                className={cn(
                  'm-0 text-[12px] leading-none font-semibold tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal',
                  TONE[phase.priority].label,
                )}
              >
                {t(`flow.priority.${phase.priority}`)}
              </h2>
              <span className="text-[12px] leading-none text-ink-muted">
                {t('flow.today.ofPhase', {
                  picked: phase.rows.filter((row) => row.listed).length,
                  total: phase.rows.length,
                })}
              </span>
            </div>
            <ul className="m-0 list-none p-0">
              {phase.rows.map((row) => (
                <TodayRow
                  key={row.plan.id}
                  visit={visit}
                  row={row}
                  chart={chart}
                  canWrite={canWrite}
                  onStart={onStart}
                />
              ))}
            </ul>
          </section>
        ))}
        {phases.length === 0 && (
          <section className="rounded-xl border border-border bg-surface px-[18px] py-[22px]">
            <p className={EMPTY_LINE}>{t('flow.today.none')}</p>
          </section>
        )}
        {canWrite && (
          <div>
            <button
              type="button"
              onClick={onAddUnplanned}
              className="h-9 cursor-pointer rounded-lg border border-dashed border-border-strong bg-surface px-[13px] text-[12.5px] leading-none font-medium text-primary hover:border-primary"
            >
              {t('flow.today.addUnplanned')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TodayRow({
  visit,
  row,
  chart,
  canWrite,
  onStart,
}: {
  visit: Visit;
  row: PlanRow;
  chart: PatientChart;
  canWrite: boolean;
  onStart: (plan: TreatmentPlan) => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const target = useTargetLabel();
  const sessionLabel = useSessionLabel();
  const text = useFileText();
  const { openViewer } = useFiles();
  const canReadFiles = usePermission('file:read');
  const files = useQuery({ ...patientFilesQuery(visit.patientId), enabled: canReadFiles });
  const tick = useMutation(useVisitMutations(visit.id).setWorkItem);
  const { plan, state, continuing, listed } = row;
  const diagnosis = chart.diagnoses.find((record) => record.id === plan.diagnosisRecordId);
  const evidence =
    diagnosis?.seenOn?.kind === 'image'
      ? files.data?.find(
          (file) => diagnosis.seenOn?.kind === 'image' && file.id === diagnosis.seenOn.fileId,
        )
      : undefined;
  const session =
    continuing || state === 'unfinished' || plan.estimatedSessions !== null
      ? sessionLabel({
          sessionNumber: sessionNumberIn(plan, visit.id),
          estimatedSessions: plan.estimatedSessions,
        })
      : null;
  // What this visit already worked on stays on its list.
  const worked = state !== 'open';

  return (
    <li
      data-work={plan.id}
      data-state={state}
      data-listed={listed || undefined}
      className={cn(
        'flex flex-wrap items-start gap-x-3.5 gap-y-2 border-t border-row-divider px-[18px] py-3',
        listed && 'bg-selected',
      )}
    >
      <input
        type="checkbox"
        aria-label={t('flow.today.forToday', { target: target(plan), name: plan.name })}
        checked={listed || worked}
        disabled={!canWrite || worked || tick.isPending}
        onChange={(event) => {
          tick.mutate(
            { planId: plan.id, listed: event.target.checked },
            {
              onError: (error) => {
                toast(t('actions.failed', { reason: apiErrorMessage(error, i18n) }), {
                  tone: 'danger',
                });
              },
            },
          );
        }}
        className="m-0 mt-0.5 size-[17px] flex-none cursor-pointer accent-primary disabled:cursor-default"
      />
      <span
        dir="ltr"
        className="w-[52px] flex-none pt-px font-mono text-[14px] leading-none font-bold text-primary rtl:text-end"
      >
        {target(plan)}
      </span>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] leading-[1.3] font-semibold">{plan.name}</span>
          {continuing && <SessionChip label={t('flow.today.inProgress')} />}
          {session && <span className="text-[12.5px] leading-none text-ink-muted">{session}</span>}
        </div>
        {diagnosis && (
          <div className="text-[12.5px] leading-[1.45] text-ink-secondary">
            <span className="font-semibold text-danger">{diagnosis.name}</span>
            {diagnosis.note && ` · ${diagnosis.note}`}
          </div>
        )}
        {evidence && (
          <button
            type="button"
            onClick={() => {
              openViewer({ patientId: visit.patientId, ids: [evidence.id] });
            }}
            className="flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[12.5px] leading-none font-medium text-primary hover:underline"
          >
            <CategoryIcon category={evidence.category} />
            {[text.kind(evidence), text.takenDate(evidence)].filter(Boolean).join(' · ')}
          </button>
        )}
      </div>
      <div className="ms-auto flex flex-none items-center gap-3">
        <span dir="ltr" className="font-mono text-[13.5px] leading-none font-semibold tabular-nums">
          {formatMoney(plan.price, locale)}
        </span>
        {worked ? (
          <span
            className={cn(
              'text-[12.5px] leading-none font-medium',
              state === 'completed' ? 'text-success' : 'text-warning',
            )}
          >
            {t(`flow.work.${state}`)}
          </span>
        ) : (
          listed &&
          canWrite && (
            <Button
              variant="primary"
              size="sm"
              className="font-semibold"
              aria-label={t(continuing ? 'flow.today.continueNamed' : 'flow.today.performNamed', {
                name: plan.name,
              })}
              onClick={() => {
                onStart(plan);
              }}
            >
              {t(continuing ? 'flow.today.continue' : 'flow.today.perform')}
            </Button>
          )
        )}
      </div>
    </li>
  );
}
