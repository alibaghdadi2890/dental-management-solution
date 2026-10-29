import { formatVisitNumber } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLevelLabel, useToothLabel } from './chart/use-chart-settings';
import { chartQuery } from './visits-api';
import { unfinishedInVisit } from './workspace/unfinished';

/**
 * What a visit did on work over several visits (unfinished spec U9, ADR-0064): one highlighted
 * line per service — which session of the work that visit was, and either "Charged in this
 * visit" (its line above is the charge) or "No charge"; or, for work it completed, "Completed"
 * and the visit that charged it. Read from the patient's chart, where each plan lists the visits
 * that worked on it. Nothing when the visit has none.
 */
export function VisitUnfinishedLines({
  patientId,
  visitId,
  className,
}: {
  patientId: string;
  visitId: string;
  className?: string;
}) {
  const { t } = useTranslation('clinical');
  const toothLabel = useToothLabel();
  const levelLabel = useLevelLabel();
  const chart = useQuery(chartQuery(patientId));
  const lines = unfinishedInVisit(chart.data?.plans ?? [], visitId);
  if (lines.length === 0) return null;
  return (
    <ul data-unfinished-lines className={cn('m-0 list-none p-0', className)}>
      {lines.map(({ plan, session, part }) => (
        <li
          key={plan.id}
          className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-[12.5px]"
        >
          <span className="min-w-0 flex-1 font-medium">{plan.name}</span>
          <span className="flex-none rounded-[4px] border border-warning-border bg-surface px-[7px] py-[3px] text-[11.5px] leading-none font-medium text-warning">
            {part === 'completed'
              ? t('unfinished.completed')
              : t('unfinished.session', { number: session })}
          </span>
          <span
            className="font-mono text-ink-muted"
            dir={plan.toothCode === null ? undefined : 'ltr'}
          >
            {plan.toothCode === null ? levelLabel(plan.jaw) : toothLabel(plan.toothCode)}
          </span>
          <span className="text-end text-ink-muted">
            {part === 'charged'
              ? t('unfinished.chargedHere')
              : part === 'completed' && plan.chargedIn !== null
                ? t('unfinished.chargedOn', { number: formatVisitNumber(plan.chargedIn.number) })
                : t('unfinished.noCharge')}
          </span>
        </li>
      ))}
    </ul>
  );
}
