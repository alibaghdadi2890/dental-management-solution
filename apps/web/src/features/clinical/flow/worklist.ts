import {
  type PatientChart,
  type PlanPriority,
  planPhases,
  type TreatmentPlan,
  type Visit,
} from '@dcm/contracts';

/** Where one planned treatment stands in this visit. */
export type WorkState = 'open' | 'completed' | 'unfinished';

export interface WorkItem {
  plan: TreatmentPlan;
  state: WorkState;
  /** Work in progress when the visit took it on: it reads by its session, not its priority. */
  continuing: boolean;
}

function itemOf(plan: TreatmentPlan, visitId: string): WorkItem {
  const state: WorkState =
    plan.performedInVisitId === visitId
      ? 'completed'
      : plan.sessions.some((session) => session.visitId === visitId)
        ? 'unfinished'
        : 'open';
  return {
    plan,
    state,
    continuing: plan.sessions.some((session) => session.visitId !== visitId),
  };
}

/**
 * The visit's list for today (feature 10, V8, V9; ADR-0048), in the order the items were put on
 * it, each with where it stands: completed here, a session taken here without finishing, or
 * still to do. A plan that has since left the chart (removed, cancelled, merged away) is left
 * out.
 */
export function worklistItems(visit: Visit, chart: PatientChart | undefined): WorkItem[] {
  const plans = new Map((chart?.plans ?? []).map((plan) => [plan.id, plan]));
  return visit.worklist.flatMap(({ planId }) => {
    const plan = plans.get(planId);
    return !plan || plan.status === 'cancelled' ? [] : [itemOf(plan, visit.id)];
  });
}

/** One row of Today's work: a treatment of the plan, and whether it is on today's list. */
export interface PlanRow extends WorkItem {
  listed: boolean;
}

export interface TodayPhase {
  priority: PlanPriority;
  rows: PlanRow[];
}

/**
 * Today's work (V8): the whole treatment plan by priority — what is still open, and what this
 * visit completed — each row saying whether it is on today's list. A phase with no row is left
 * out. What earlier visits completed is not today's business.
 */
export function todayPhases(visit: Visit, chart: PatientChart): TodayPhase[] {
  const listed = new Set(visit.worklist.map((item) => item.planId));
  return planPhases(chart.plans)
    .map((phase) => ({
      priority: phase.priority,
      rows: [
        ...phase.open,
        ...phase.done.filter((plan) => plan.performedInVisitId === visit.id),
      ].map((plan) => ({ ...itemOf(plan, visit.id), listed: listed.has(plan.id) })),
    }))
    .filter((phase) => phase.rows.length > 0);
}
