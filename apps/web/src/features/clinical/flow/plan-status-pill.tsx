import type { TreatmentPlan } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type PlanWord = 'in_progress' | 'done' | 'accepted' | 'planned';

const TONE: Record<PlanWord, string> = {
  in_progress: 'border-warning-border bg-warning-bg text-warning',
  done: 'border-border bg-subtle text-ink-muted',
  accepted: 'border-success-border bg-success-bg text-success',
  planned: 'border-border bg-faint text-ink-secondary',
};

/**
 * Where a planned treatment stands, as a pill: In progress, Done, or Planned — and, with
 * `acceptance`, Accepted for a planned one the patient agreed to (the Overview's plan card; the
 * Treatment plan tab has a column of its own for that).
 */
export function PlanStatusPill({
  plan,
  acceptance = false,
}: {
  plan: Pick<TreatmentPlan, 'status' | 'acceptedAt'>;
  acceptance?: boolean;
}) {
  const { t } = useTranslation('clinical');
  const word: PlanWord =
    plan.status === 'in_progress'
      ? 'in_progress'
      : plan.status === 'performed'
        ? 'done'
        : acceptance && plan.acceptedAt !== null
          ? 'accepted'
          : 'planned';
  return (
    <span
      data-plan-status={word}
      className={cn(
        'flex-none rounded-[4px] border px-[7px] py-[3px] text-[11.5px] leading-none font-medium whitespace-nowrap',
        TONE[word],
      )}
    >
      {t(`flow.planStatus.${word}`)}
    </span>
  );
}
