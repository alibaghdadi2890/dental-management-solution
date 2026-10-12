import type { PlanPriority, ServiceItem } from '@dcm/contracts';
import { type Ref, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSurfaceLabel, useToothLabel } from '../chart/use-chart-settings';
import { DEFAULT_PLAN_PRIORITY, useChartingActions } from '../workspace/charting-actions';
import { MICRO } from './flow-styles';
import { PriorityControl } from './priority-control';
import { ProposedPlans } from './proposed-plans';
import type { Proposal } from './proposals';
import { ServicePicker } from './service-picker';

/**
 * One proposal (feature 10, V7): a diagnosis and what is proposed for it. Left, the tooth, the
 * diagnosis, its surfaces (or, for one carried from before, when it was recorded) and the
 * priority — of every treatment on the card, and of the next one chosen. Right, the treatments
 * chosen with their price and Remove (`ProposedPlans`), then the catalog to choose from
 * (`ServicePicker`). A treatment is planned on the diagnosed tooth and surfaces, for this
 * diagnosis.
 */
export function ProposalCard({
  proposal,
  services,
  canWrite,
  focused,
  cardRef,
}: {
  proposal: Proposal;
  /** The active catalog services that go on a tooth. */
  services: readonly ServiceItem[];
  canWrite: boolean;
  /** The card the step was opened for (the diagnosis toast's Plan treatment). */
  focused: boolean;
  cardRef?: Ref<HTMLElement> | undefined;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const toothLabel = useToothLabel();
  const surfaceLabel = useSurfaceLabel();
  const { record, plans } = proposal;
  // The priority chosen before there is a treatment to carry it.
  const [picked, setPicked] = useState<PlanPriority>(DEFAULT_PLAN_PRIORITY);
  const priority = plans[0]?.priority ?? picked;

  const setPriority = (next: PlanPriority) => {
    setPicked(next);
    for (const plan of plans) {
      if (plan.priority !== next) actions.setPlanPriority(plan.id, next);
    }
  };
  const propose = (item: ServiceItem) => {
    actions.planTreatment(
      item,
      { tooth: record.toothCode, surfaces: record.surfaces },
      { priority, diagnosisRecordId: record.id },
    );
  };

  const surfaces = surfaceLabel.format(record.surfaces);
  const sub = proposal.isNew
    ? surfaces && t('flow.proposal.surfaces', { surfaces })
    : [
        t('flow.findings.recorded', { date: formatCalendarDate(record.recordedDate, locale) }),
        surfaces,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-label={t('flow.proposal.named', {
        tooth: toothLabel(record.toothCode),
        name: record.name,
      })}
      data-proposal={record.id}
      className={cn(
        'grid rounded-xl border bg-surface outline-none md:grid-cols-[minmax(200px,250px)_minmax(0,1fr)]',
        focused ? 'border-primary shadow-[0_0_0_1px_var(--color-primary)]' : 'border-border',
      )}
    >
      <div className="rounded-s-xl border-row-divider bg-sunken px-[18px] py-4 md:border-e">
        <div
          dir="ltr"
          className="font-mono text-[18px] leading-none font-bold text-primary rtl:text-end"
        >
          {toothLabel(record.toothCode)}
        </div>
        <div className="mt-[7px] text-[13px] leading-[1.35] font-semibold text-danger">
          {record.name}
        </div>
        {sub && <div className="mt-[3px] text-[12px] leading-[1.35] text-ink-muted">{sub}</div>}
        <div className={cn(MICRO, 'mt-4 mb-[7px]')}>{t('flow.proposal.priority')}</div>
        <PriorityControl
          value={priority}
          label={t('flow.proposal.priorityOf', { name: record.name })}
          disabled={!canWrite}
          onChange={setPriority}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2.5 px-[18px] py-3.5">
        {plans.length === 0 ? (
          <span className="text-[12.5px] leading-[1.45] text-ink-muted">
            {t('flow.proposal.none')}
          </span>
        ) : (
          <ProposedPlans plans={plans} canWrite={canWrite} />
        )}
        {canWrite && (
          <ServicePicker
            services={services}
            searchLabel={t('flow.proposal.searchNamed', { name: record.name })}
            onPick={propose}
          />
        )}
      </div>
    </section>
  );
}
