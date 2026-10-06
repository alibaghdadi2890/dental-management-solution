import type { Money, TreatmentPlan } from '@dcm/contracts';
import type { ChartingScope } from './charting-actions';
import { plansTotal } from './tooth-panel/tooth-records';

/** A patient's unfinished services (ADR-0032: plans in progress), as one visit sees them. */
export interface UnfinishedWork {
  /** Not worked on in this visit: waiting at the top of the services card. */
  toContinue: TreatmentPlan[];
  /** Worked on in this visit: listed with its services, still not finished. */
  workedHere: TreatmentPlan[];
  /** What all of it will charge once completed; `null` without any. */
  carried: Money | null;
}

export const workedIn = (plan: TreatmentPlan, visitId: string) =>
  plan.sessions.some((session) => session.visitId === visitId);

/** `visitId` null is the patient record: nothing is worked on there. */
export function unfinishedWork(
  plans: readonly TreatmentPlan[],
  visitId: string | null,
): UnfinishedWork {
  const unfinished = plans.filter((plan) => plan.status === 'in_progress');
  const here = (plan: TreatmentPlan) => visitId !== null && workedIn(plan, visitId);
  return {
    toContinue: unfinished.filter((plan) => !here(plan)),
    workedHere: unfinished.filter(here),
    carried: plansTotal(unfinished),
  };
}

/**
 * What `visitId` worked on without finishing it: every plan with a session in that visit, unless
 * that visit also completed it (then its service says so). `session` is which of the plan's
 * sessions that visit was, from 1.
 */
export function unfinishedInVisit(
  plans: readonly TreatmentPlan[],
  visitId: string,
): { plan: TreatmentPlan; session: number }[] {
  return plans.flatMap((plan) => {
    const index = plan.sessions.findIndex((session) => session.visitId === visitId);
    return index < 0 || plan.performedInVisitId === visitId ? [] : [{ plan, session: index + 1 }];
  });
}

export type UnfinishedAction = 'complete' | 'continue' | 'notToday' | 'remove' | 'cancel';

/**
 * What an unfinished service offers where it is shown (unfinished spec U4, U7). In the visit that
 * worked on it: **Complete**, and **Not today** when earlier visits worked on it too, else
 * **Remove** (it was first added here). In a visit that hasn't: **Continue** or **Cancel**. On the
 * patient record: **Cancel** only.
 */
export function unfinishedActions(plan: TreatmentPlan, scope: ChartingScope): UnfinishedAction[] {
  if (scope.kind === 'patient') return ['cancel'];
  if (!workedIn(plan, scope.visitId)) return ['continue', 'cancel'];
  return ['complete', plan.sessions.length > 1 ? 'notToday' : 'remove'];
}
