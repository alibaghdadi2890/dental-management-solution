import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLevelLabel, useToothLabel } from './chart/use-chart-settings';
import { chartQuery } from './visits-api';
import { unfinishedInVisit } from './workspace/unfinished';

/**
 * What a visit worked on without finishing it (unfinished spec U9): one highlighted line per
 * service, with which session of the work that visit was, at no charge — the visit that completes
 * it carries the charge. Read from the patient's chart, where each plan lists the
 * visits that worked on it. Nothing when the visit has none.
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
      {lines.map(({ plan, session }) => (
        <li
          key={plan.id}
          className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-[12.5px]"
        >
          <span className="min-w-0 flex-1 font-medium">{plan.name}</span>
          <span className="flex-none rounded-[4px] border border-warning-border bg-surface px-[7px] py-[3px] text-[11.5px] leading-none font-medium text-warning">
            {t('unfinished.session', { number: session })}
          </span>
          <span
            className="font-mono text-ink-muted"
            dir={plan.toothCode === null ? undefined : 'ltr'}
          >
            {plan.toothCode === null ? levelLabel(plan.jaw) : toothLabel(plan.toothCode)}
          </span>
          <span className="w-20 text-end text-ink-muted">{t('unfinished.noCharge')}</span>
        </li>
      ))}
    </ul>
  );
}
