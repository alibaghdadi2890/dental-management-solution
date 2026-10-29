import type { PatientChart, Visit } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { completeCheck, hasQuestions } from '../dialogs/complete-check';
import { useFlushSaveGroups } from '../save-groups-context';
import { useVisitMutations, useVisitMutationsSettled } from '../visit-mutations';
import { chartQuery, visitQuery } from '../visits-api';

/**
 * **Complete visit** on the Complete step (ADR-0065): the step is the review, so there is no
 * Visit Summary. `finish` sends every unsaved edit — a failure stops there and says so —, waits
 * for the visit's writes in flight, then completes; when the check before Complete has something
 * the page has not asked (`shown`), it calls `onCheck` instead, whose confirmation calls
 * `complete`. Once completed, the page leaves for the record with the post-visit summary, where
 * the payment is taken (W16). A failure is a toast.
 */
export function useFinishVisit({
  visit,
  chart,
  shown,
  onCheck,
}: {
  visit: Visit;
  chart: PatientChart | undefined;
  shown: ReadonlySet<string>;
  onCheck: () => void;
}): { finishing: boolean; finish: () => void; complete: () => void } {
  const { t } = useTranslation('clinical');
  const toast = useToast();
  const queryClient = useQueryClient();
  const flush = useFlushSaveGroups();
  const settled = useVisitMutationsSettled(visit.id);
  const { mutateAsync } = useMutation(useVisitMutations(visit.id).complete);
  const [finishing, setFinishing] = useState(false);

  const complete = useCallback(() => {
    setFinishing(true);
    // Completed: the page, which reads the cached visit, leaves for the record.
    mutateAsync().catch((failure: unknown) => {
      toast(t('summary.failed', { reason: failure instanceof Error ? failure.message : '' }), {
        tone: 'danger',
      });
      setFinishing(false);
    });
  }, [mutateAsync, toast, t]);

  const finish = useCallback(() => {
    setFinishing(true);
    void (async () => {
      if (!(await flush())) {
        toast(t('summary.unsaved'), { tone: 'danger' });
        setFinishing(false);
        return;
      }
      await settled();
      // The writes just settled refreshed the cache; the props may not have re-rendered yet.
      const current = queryClient.getQueryData(visitQuery(visit.id).queryKey) ?? visit;
      const charted = queryClient.getQueryData(chartQuery(visit.patientId).queryKey) ?? chart;
      if (charted && hasQuestions(completeCheck(current, charted, new Map(), shown))) {
        setFinishing(false);
        onCheck();
        return;
      }
      complete();
    })();
  }, [flush, settled, queryClient, visit, chart, shown, onCheck, complete, toast, t]);

  return { finishing, finish, complete };
}
