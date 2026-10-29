import type { Money, TreatmentPlan, VisitService } from '@dcm/contracts';
import type { ChartingScope } from './charting-actions';
import { plansTotal } from './tooth-panel/tooth-records';

/** A patient's unfinished services (ADR-0032: plans in progress), as one visit sees them. */
export interface UnfinishedWork {
  /** Not worked on in this visit: waiting at the top of the services card. */
  toContinue: TreatmentPlan[];
  /** Worked on in this visit: listed with its services, still not finished. */
  workedHere: TreatmentPlan[];
  /** Completed in this visit and charged by an earlier one (ADR-0064): "Charged on visit #N". */
  completedHere: TreatmentPlan[];
  /** What the work nothing charges yet will charge once completed — work started before it was
   * charged at its start; `null` without any. */
  carried: Money | null;
}

export const workedIn = (plan: TreatmentPlan, visitId: string) =>
  plan.sessions.some((session) => session.visitId === visitId);

/** The line that charges the work is in this visit (ADR-0064). */
export const chargedHere = (plan: TreatmentPlan, visitId: string) =>
  plan.chargedIn?.visitId === visitId;

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
    completedHere:
      visitId === null
        ? []
        : plans.filter(
            (plan) =>
              plan.status === 'performed' &&
              plan.performedInVisitId === visitId &&
              plan.chargedIn !== null &&
              !chargedHere(plan, visitId),
          ),
    carried: plansTotal(unfinished.filter((plan) => plan.chargedIn === null)),
  };
}

/**
 * The services of a visit that charge work still in progress (ADR-0064). Lists that show that
 * work as an unfinished row leave these lines out, so the work is shown once.
 */
export function chargingUnfinished(
  services: readonly VisitService[],
  plans: readonly TreatmentPlan[],
): VisitService[] {
  const unfinished = new Set(
    plans.filter((plan) => plan.status === 'in_progress').map((plan) => plan.id),
  );
  return services.filter((service) => service.planId !== null && unfinished.has(service.planId));
}

/** `services` without the lines that charge work still in progress. */
export function finishedServices(
  services: readonly VisitService[],
  plans: readonly TreatmentPlan[],
): VisitService[] {
  const charging = new Set(chargingUnfinished(services, plans).map((service) => service.id));
  return services.filter((service) => !charging.has(service.id));
}

/** How a visit took part in unfinished work, for the lines under its services. */
export type UnfinishedPart =
  /** A later session, at no charge. */
  | 'session'
  /** The session that started it, whose line (above) charges it. */
  | 'charged'
  /** Completed it; an earlier visit charged it. */
  | 'completed';

/**
 * What `visitId` did on work over several visits that its own lines do not say: each session on
 * work not completed there, and work it completed that an earlier visit charged (ADR-0064).
 * `session` is which of the plan's sessions that visit was, from 1 (0 when it had none).
 */
export function unfinishedInVisit(
  plans: readonly TreatmentPlan[],
  visitId: string,
): { plan: TreatmentPlan; session: number; part: UnfinishedPart }[] {
  return plans.flatMap((plan): { plan: TreatmentPlan; session: number; part: UnfinishedPart }[] => {
    const index = plan.sessions.findIndex((session) => session.visitId === visitId);
    if (plan.performedInVisitId === visitId) {
      return plan.chargedIn !== null && !chargedHere(plan, visitId)
        ? [{ plan, session: index + 1, part: 'completed' }]
        : [];
    }
    if (index < 0) return [];
    return [
      {
        plan,
        session: index + 1,
        part: chargedHere(plan, visitId) ? 'charged' : 'session',
      },
    ];
  });
}

export type UnfinishedAction = 'complete' | 'continue' | 'notToday' | 'remove' | 'cancel';

/**
 * What an unfinished service offers where it is shown (unfinished spec U4, U7). In the visit that
 * worked on it: **Complete**, and **Remove** when it was first added or charged here (ADR-0064),
 * else **Not today**. In a visit that hasn't: **Continue** or **Cancel**. On the patient record:
 * **Cancel** only.
 */
export function unfinishedActions(plan: TreatmentPlan, scope: ChartingScope): UnfinishedAction[] {
  if (scope.kind === 'patient') return ['cancel'];
  if (!workedIn(plan, scope.visitId)) return ['continue', 'cancel'];
  const startedHere = plan.sessions.length === 1 || chargedHere(plan, scope.visitId);
  return ['complete', startedHere ? 'remove' : 'notToday'];
}
