import type { PatientChart, TreatmentPlan, Visit } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/use-permission';
import { patientFilesQuery } from '@/features/files/files-api';
import { useFiles } from '@/features/files/files-context';
import { visitFiles } from '@/features/files/gallery/gallery-filter';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useChartingActions } from '../workspace/charting-actions';
import { useToothSelection } from '../workspace/tooth-selection';
import { useSessionLabel } from './flow-labels';
import { PriorityChip, SessionChip } from './priority-chip';
import { useTargetLabel } from './use-target-label';
import { sessionNumberIn } from './visit-facts';
import { type WorkItem, worklistItems } from './worklist';

const ROW_BUTTON = 'h-7 flex-none cursor-pointer rounded-md px-2.5 text-[12.5px] leading-none';

/**
 * Perform's **Planned for today** (feature 10, V9): the treatments ticked on Today's work, each
 * with **Complete** — the plan becomes a service of this visit at its planned
 * price — and **Not finished** — this visit's session is logged, with no charge — then, once
 * either was done, what was done and **Undo**. A row's tooth selects it on the chart, and the
 * row of the selected tooth is highlighted. **Before photo** opens the upload panel with the
 * tooth and the visit pre-filled; once the tooth has one from this visit, it reads **After
 * photo**. Nothing without planned items.
 */
export function PlannedToday({
  visit,
  chart,
  canWrite,
}: {
  visit: Visit;
  chart: PatientChart | undefined;
  canWrite: boolean;
}) {
  const { t } = useTranslation('clinical');
  const titleId = useId();
  const items = worklistItems(visit, chart);
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 overflow-hidden rounded-xl border border-planned-border bg-surface"
    >
      <div className="flex items-center gap-[9px] bg-planned-strip px-4 py-[13px]">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold text-warning">
          {t('flow.planned.title')}
        </h2>
        <span className="ms-auto text-[12.5px] leading-none text-ink-muted">
          {t('flow.planned.count', { count: items.length })}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {items.map((item) => (
          <PlannedRow key={item.plan.id} visit={visit} item={item} canWrite={canWrite} />
        ))}
      </ul>
    </section>
  );
}

function PlannedRow({
  visit,
  item,
  canWrite,
}: {
  visit: Visit;
  item: WorkItem;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const selection = useToothSelection();
  const target = useTargetLabel();
  const sessionLabel = useSessionLabel();
  const { plan, state, continuing } = item;
  const { toothCode } = plan;
  const selected =
    toothCode === null ? selection.area === (plan.jaw ?? 'mouth') : selection.tooth === toothCode;
  const session =
    continuing || state === 'unfinished' || plan.estimatedSessions !== null
      ? sessionLabel({
          sessionNumber: sessionNumberIn(plan, visit.id),
          estimatedSessions: plan.estimatedSessions,
        })
      : null;

  const undo = () => {
    if (state === 'unfinished') {
      actions.undoSession(plan);
      return;
    }
    const service = visit.services.find((line) => line.planId === plan.id);
    if (service) actions.removeService(service.id);
  };

  return (
    <li
      data-planned={plan.id}
      data-state={state}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-planned-strip-border px-4 py-3',
        selected && 'bg-selected',
      )}
    >
      <button
        type="button"
        dir={toothCode === null ? undefined : 'ltr'}
        onClick={() => {
          if (toothCode === null) {
            if (!selected) selection.selectArea(plan.jaw ?? 'mouth');
          } else selection.select(toothCode);
        }}
        className="min-w-[38px] flex-none cursor-pointer border-0 bg-transparent p-0 text-start font-mono text-[13px] leading-none font-bold text-primary hover:underline"
      >
        {target(plan)}
      </button>
      <span className="text-[13px] leading-[1.35] font-semibold">{plan.name}</span>
      {continuing ? (
        <SessionChip label={t('flow.today.inProgress')} />
      ) : (
        <PriorityChip priority={plan.priority} />
      )}
      {session && <span className="text-[12px] leading-none text-ink-muted">{session}</span>}
      <span className="ms-auto flex flex-wrap items-center justify-end gap-2">
        <span
          dir="ltr"
          className={cn(
            'font-mono text-[13px] leading-none font-semibold tabular-nums',
            state === 'unfinished' && 'text-ink-muted',
          )}
        >
          {formatMoney(plan.price, locale)}
        </span>
        {toothCode !== null && <PhotoButton visit={visit} plan={plan} />}
        {canWrite && state === 'open' && (
          <>
            <button
              type="button"
              title={t('flow.planned.notFinishedHint')}
              aria-label={t('flow.planned.notFinishedNamed', { name: plan.name })}
              onClick={() => {
                actions.continuePlan(plan);
              }}
              className={cn(
                ROW_BUTTON,
                'border border-warning-border bg-warning-bg font-medium text-warning hover:border-warning',
              )}
            >
              {t('unfinished.badge')}
            </button>
            <button
              type="button"
              aria-label={t('unfinished.completeNamed', { name: plan.name })}
              onClick={() => {
                actions.performPlan(plan);
              }}
              className={cn(
                ROW_BUTTON,
                'border border-primary bg-primary px-3 font-semibold text-primary-foreground hover:bg-primary-hover',
              )}
            >
              {t('unfinished.complete')}
            </button>
          </>
        )}
        {state !== 'open' && (
          <>
            <span
              className={cn(
                'text-[12.5px] leading-none font-medium',
                state === 'completed' ? 'text-success' : 'text-warning',
              )}
            >
              {t(`flow.work.${state === 'completed' ? 'completed' : 'unfinished'}`)}
            </span>
            {canWrite && (
              <button
                type="button"
                aria-label={t('flow.today.undoNamed', { name: plan.name })}
                onClick={undo}
                className="cursor-pointer border-0 bg-transparent px-0.5 py-0 text-[12.5px] font-medium text-primary hover:underline"
              >
                {t('actions.undo')}
              </button>
            )}
          </>
        )}
      </span>
    </li>
  );
}

/** **Before photo**, then **After photo** once this visit has one of the tooth. */
function PhotoButton({ visit, plan }: { visit: Visit; plan: TreatmentPlan }) {
  const { t } = useTranslation('clinical');
  const { openUpload } = useFiles();
  const canRead = usePermission('file:read');
  const canWrite = usePermission('file:write');
  const files = useQuery({ ...patientFilesQuery(visit.patientId), enabled: canRead });
  if (!canWrite || plan.toothCode === null) return null;
  const taken = visitFiles(files.data ?? [], visit.id).filter(
    (file) => file.toothCode === plan.toothCode && file.subCategory === 'before_after',
  ).length;
  const label = t(taken === 0 ? 'flow.planned.beforePhoto' : 'flow.planned.afterPhoto');
  return (
    <button
      type="button"
      onClick={() => {
        openUpload({
          patientId: visit.patientId,
          visit,
          toothCode: plan.toothCode,
          preset: { category: 'photo', subCategory: 'before_after', note: label },
        });
      }}
      className={cn(
        ROW_BUTTON,
        'border border-border-control bg-surface font-medium text-ink-secondary hover:border-ink',
      )}
    >
      {label}
    </button>
  );
}
