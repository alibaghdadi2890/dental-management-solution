import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropSaveGroup, useFlushSaveGroups } from '../save-groups-context';
import { useVisitMutations } from '../visit-mutations';
import { servicePriceKey } from '../workspace/charting-actions';
import type { CheckDecisions } from './complete-check';

/**
 * Applies the check's answers one by one (ADR-0065): Finished plans are performed here, services
 * that Continue are marked not finished — their price edits saved first, as the plan takes the
 * price — then the ticked diagnoses are resolved. Rejects at the first failure; what was applied
 * before it stays.
 */
export function useApplyCheck(visitId: string): (decisions: CheckDecisions) => Promise<void> {
  const { t } = useTranslation('clinical');
  const mutations = useVisitMutations(visitId);
  const { mutateAsync: perform } = useMutation(mutations.performPlan);
  const { mutateAsync: unfinish } = useMutation(mutations.markUnfinished);
  const { mutateAsync: resolve } = useMutation(mutations.resolveDiagnosis);
  const flush = useFlushSaveGroups();
  const drop = useDropSaveGroup();
  return useCallback(
    async ({ finish, unfinish: services, resolve: records }) => {
      for (const planId of finish) await perform(planId);
      if (services.length > 0 && !(await flush())) throw new Error(t('actions.unsavedPrice'));
      for (const serviceId of services) {
        drop(servicePriceKey(serviceId));
        await unfinish(serviceId);
      }
      for (const recordId of records) await resolve(recordId);
    },
    [perform, unfinish, resolve, flush, drop, t],
  );
}
