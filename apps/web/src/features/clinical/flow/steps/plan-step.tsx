import type { PatientChart, Visit } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { openPrintable, printPath } from '@/features/billing/payments-api';
import { servicesQuery } from '../../catalog/catalog-api';
import { EMPTY_LINE, STEP_BODY } from '../flow-styles';
import { OtherTreatmentCard } from '../other-treatment-card';
import { PhasePanels } from '../phase-panels';
import { ProposalCard } from '../proposal-card';
import { otherPlans, proposals } from '../proposals';

/**
 * **Plan** — **Proposal** in a consultation (feature 10, V7): one card per diagnosis to treat,
 * today's and the ones carried from Findings; under them **Other treatment**, for another tooth,
 * a jaw or the whole mouth; then the whole treatment plan as its three phases with their totals,
 * and **Print quote**. `focusId` is the diagnosis the step was opened for:
 * its card takes the focus and is scrolled to.
 */
export function PlanStep({
  visit,
  chart,
  canWrite,
  carried,
  focusId,
}: {
  visit: Visit;
  chart: PatientChart | undefined;
  canWrite: boolean;
  carried: ReadonlySet<string>;
  focusId: string | null;
}) {
  const { t } = useTranslation('clinical');
  const services = useQuery({ ...servicesQuery(), enabled: canWrite });
  const focusRef = useRef<HTMLElement>(null);
  const cards = chart ? proposals(chart, visit.id, carried) : [];
  const focusShown = cards.some((card) => card.record.id === focusId);
  useEffect(() => {
    if (!focusShown) return;
    // Focusing it also scrolls it into view.
    focusRef.current?.focus();
  }, [focusId, focusShown]);

  if (chart === undefined) {
    return (
      <div data-step="plan" className={STEP_BODY}>
        <section className="rounded-xl border border-border bg-surface px-[18px] py-4">
          <CardSkeleton label={t('workspace.loading')} />
        </section>
      </div>
    );
  }
  const active = (services.data ?? []).filter((item) => item.active);
  // A diagnosis is on a tooth, so its treatment is one charged per tooth.
  const perTooth = active.filter((item) => item.chargeUnit === 'per_tooth');

  return (
    <div data-step="plan" className={STEP_BODY}>
      <div className="flex flex-col gap-3">
        {cards.map((card) => (
          <ProposalCard
            key={card.record.id}
            proposal={card}
            services={perTooth}
            canWrite={canWrite}
            focused={card.record.id === focusId}
            cardRef={card.record.id === focusId ? focusRef : undefined}
          />
        ))}
        {cards.length === 0 && (
          <section className="rounded-xl border border-border bg-surface px-[18px] py-[22px]">
            <p className={EMPTY_LINE}>{t('flow.proposal.noDiagnoses')}</p>
          </section>
        )}
        {canWrite && (
          <OtherTreatmentCard
            plans={otherPlans(chart, visit.id, cards)}
            services={active}
            withPrimary={chart.dentition.stage !== 'permanent'}
          />
        )}
        <div className="mt-1 flex flex-wrap items-stretch gap-3">
          <PhasePanels chart={chart} newIn={visit.id} currency={visit.currency} />
          <Button
            variant="outline"
            className="h-[38px] self-start px-[15px] text-[13px]"
            onClick={() => {
              openPrintable(printPath.quote(visit.patientId));
            }}
          >
            {t('flow.proposal.printQuote')}
          </Button>
        </div>
      </div>
    </div>
  );
}
