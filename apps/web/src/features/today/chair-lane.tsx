import { stepLabelKey, type VisitListItem } from '@dcm/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useElapsedText } from '@/features/clinical/use-visit-timer';
import { cn } from '@/lib/utils';

/**
 * One live visit of the branch (Today board, T4; feature 10, V15): the patient, the visit's type,
 * the dentist and room, the step it is on as a pill ("On Perform"), and the running or paused
 * time. With `visit:write` the name links to the workspace, which opens on that step.
 */
export function ChairRow({
  visit,
  receivedAt,
  canOpen,
}: {
  visit: VisitListItem;
  /** When the list arrived: the timer runs from the server's clock (`useElapsedText`). */
  receivedAt: number;
  canOpen: boolean;
}) {
  const { t } = useTranslation(['today', 'clinical']);
  const elapsed = useElapsedText(visit, receivedAt);
  // The key is built at run time; every `stepLabelKey` value has its `flow.steps` entry.
  const stepLabel = (t as (key: string) => string)(
    `clinical:flow.steps.${stepLabelKey(visit.type, visit.currentStep)}`,
  );
  const running = visit.status === 'in_progress';

  return (
    <li className="flex items-center gap-3 border-t border-inner-divider px-[18px] py-3 first:border-t-0">
      <span
        aria-hidden
        className={cn(
          'size-1.5 flex-none rounded-full',
          running ? 'animate-pulsedot bg-primary' : 'bg-primary-tint-strong',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        {canOpen ? (
          <Link
            to="/visits/$visitId"
            params={{ visitId: visit.id }}
            className="text-[13.5px] leading-tight font-semibold hover:text-primary hover:underline"
          >
            {visit.patient.fullName}
          </Link>
        ) : (
          <span className="text-[13.5px] leading-tight font-semibold">
            {visit.patient.fullName}
          </span>
        )}
        <span className="text-[12.5px] leading-snug text-ink-muted">
          {[t(`clinical:flow.types.${visit.type}`), visit.dentist.name, visit.room?.name]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <span
        data-step={visit.currentStep}
        className="flex-none rounded-[5px] border border-primary-tint-border bg-primary-tint px-2 py-[3px] text-[11.5px] leading-none font-medium text-primary"
      >
        {t('chair.onStep', { step: stepLabel })}
      </span>
      {!running && (
        <span className="flex-none text-[11.5px] leading-none text-ink-muted">
          {t('chair.paused')}
        </span>
      )}
      <span
        dir="ltr"
        className="flex-none font-mono text-[12.5px] leading-none font-semibold text-primary tabular-nums"
      >
        {elapsed}
      </span>
    </li>
  );
}
