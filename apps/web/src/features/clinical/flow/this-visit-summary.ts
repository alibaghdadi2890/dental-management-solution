import {
  type DiagnosisRecord,
  type Money,
  type PatientChart,
  planPhases,
  type TreatmentPlan,
  type Visit,
} from '@dcm/contracts';
import { plansTotal } from '../workspace/tooth-panel/tooth-records';
import { unfinishedInVisit } from '../workspace/unfinished';

/** What the next visit is for: work to continue, or the first urgent item still open. */
export type NextVisit = { kind: 'continue' | 'urgent'; plan: TreatmentPlan };

/**
 * The Complete step's **This visit** block (feature 10, V10): what the visit put on the record,
 * in four parts. A part with nothing in it is left out by the screen.
 */
export interface ThisVisitSummary {
  /** Recorded: the diagnoses of this visit. */
  recorded: DiagnosisRecord[];
  /** Added to the plan: what this visit planned and did not do; `total` is null without any. */
  planned: { plans: TreatmentPlan[]; total: Money | null };
  /** Done today: the visit's services and what they charge. */
  done: { count: number; total: Money };
  /** Continues next visit: work this visit took a session on without finishing it. */
  continues: { plan: TreatmentPlan; session: number }[];
  next: NextVisit | null;
  /** Whether any part has something to show. */
  empty: boolean;
}

export function thisVisitSummary(visit: Visit, chart: PatientChart): ThisVisitSummary {
  const here = (visitId: string | null) => visitId === visit.id;
  const recorded = chart.diagnoses.filter((record) => here(record.recordedInVisitId));
  const planned = chart.plans.filter(
    (plan) => here(plan.recordedInVisitId) && plan.status === 'planned',
  );
  const continues = unfinishedInVisit(chart.plans, visit.id);
  const phases = planPhases(chart.plans);
  // Work in progress comes back first: it is already started, and paid for only when done.
  const inProgress = phases
    .flatMap((phase) => phase.open)
    .find((plan) => plan.status === 'in_progress');
  const urgent = phases.find((phase) => phase.priority === 'urgent')?.open[0];
  return {
    recorded,
    planned: { plans: planned, total: plansTotal(planned) },
    done: {
      count: visit.services.length,
      total: { amount: visit.money.subtotal, currency: visit.currency },
    },
    continues,
    next: inProgress
      ? { kind: 'continue', plan: inProgress }
      : urgent
        ? { kind: 'urgent', plan: urgent }
        : null,
    empty:
      recorded.length === 0 &&
      planned.length === 0 &&
      visit.services.length === 0 &&
      continues.length === 0,
  };
}
