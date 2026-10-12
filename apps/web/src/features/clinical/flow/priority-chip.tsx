import type { PlanPriority } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PRIORITY_TONE } from './priority-tone';

const CHIP =
  'inline-flex flex-none items-center rounded-[4px] border px-[7px] py-[3px] text-[11.5px] leading-none font-medium';

/** A plan's priority — the phase of the treatment plan it belongs to (ADR-0045) — as a chip. */
export function PriorityChip({ priority }: { priority: PlanPriority }) {
  const { t } = useTranslation('clinical');
  return (
    <span data-priority={priority} className={cn(CHIP, PRIORITY_TONE[priority])}>
      {t(`flow.priority.${priority}`)}
    </span>
  );
}

/** "Session 2 of 3": work in progress reads by its session, not its priority. */
export function SessionChip({ label }: { label: string }) {
  return <span className={cn(CHIP, PRIORITY_TONE.high)}>{label}</span>;
}
