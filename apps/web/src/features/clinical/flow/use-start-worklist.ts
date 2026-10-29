import type { PatientChart, TreatmentPlan, Visit } from '@dcm/contracts';
import { MutationObserver, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { useVisitMutations } from '../visit-mutations';
import { worklistItems } from './worklist';

/**
 * Planned work the visit already has a line for, without a plan: the same service at the same
 * place — a hygiene visit's automatic scaling and the planned one. Starting it would charge it
 * twice, so it is left to the dentist.
 */
const coveredBy = (visit: Visit, plan: TreatmentPlan) =>
  plan.status === 'planned' &&
  visit.services.some(
    (service) =>
      service.planId === null &&
      service.procedureId === plan.procedureId &&
      service.toothCode === plan.toothCode &&
      service.jaw === plan.jaw,
  );

/**
 * Entering Perform starts the work ticked for today (ADR-0065): every item of the visit's list it
 * has not worked on gets this visit's session — planned work with the line that charges it at
 * the plan's price (ADR-0064) — so it is listed in Today's services without being picked again.
 * One at a time, each tried once per stay on Perform; a failure is a toast. Planned work a line
 * of the visit already charges is not started (`coveredBy`). `active` is the steps view on
 * Perform, for who may chart a live visit.
 */
export function useStartWorklist({
  visit,
  chart,
  active,
}: {
  visit: Visit;
  chart: PatientChart | undefined;
  active: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { recordSession } = useVisitMutations(visit.id);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    if (!active) {
      tried.current.clear();
      return;
    }
    if (!chart) return;
    const plans = worklistItems(visit, chart)
      .filter(
        (item) =>
          item.state === 'open' && !tried.current.has(item.plan.id) && !coveredBy(visit, item.plan),
      )
      .map((item) => item.plan.id);
    if (plans.length === 0) return;
    for (const planId of plans) tried.current.add(planId);
    void (async () => {
      for (const planId of plans) {
        try {
          await new MutationObserver(queryClient, recordSession).mutate(planId);
        } catch (error) {
          toast(t('actions.failed', { reason: apiErrorMessage(error, i18n) }), { tone: 'danger' });
        }
      }
    })();
  }, [active, chart, visit, queryClient, recordSession, toast, t, i18n]);
}
