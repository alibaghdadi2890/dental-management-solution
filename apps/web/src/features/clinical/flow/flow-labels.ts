import { stepLabelKey, type VisitStep, type VisitType } from '@dcm/contracts';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/** `(type, step) => 'Proposal'`: a step's label depends on the visit's type (ADR-0044). */
export function useStepLabel(): (type: VisitType, step: VisitStep) => string {
  const { t } = useTranslation('clinical');
  return useCallback(
    (type: VisitType, step: VisitStep) => {
      // The key is built at run time; every `stepLabelKey` value has its `flow.steps` entry.
      const translate = t as (key: string) => string;
      return translate(`flow.steps.${stepLabelKey(type, step)}`);
    },
    [t],
  );
}

/** "Session 2 of 3" for work in progress, "Session 2" when nobody knows how many it takes. */
export function useSessionLabel(): (session: {
  /** Null for work that has no session to speak of. */
  sessionNumber: number | null;
  estimatedSessions: number | null;
}) => string | null {
  const { t } = useTranslation('clinical');
  return useCallback(
    ({ sessionNumber, estimatedSessions }) => {
      if (sessionNumber === null) return null;
      return estimatedSessions === null
        ? t('flow.session', { number: sessionNumber })
        : t('flow.sessionOf', { number: sessionNumber, total: estimatedSessions });
    },
    [t],
  );
}
