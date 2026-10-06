import type { PlanStatus } from '@dcm/contracts';
import { PlanNotInProgressError, PlanNotOpenError } from './visit-errors';

/**
 * A treatment plan's lifecycle (ADR-0032): `planned → in_progress → performed`, with `cancelled`
 * from either open state. Work that takes several visits is started in one (its first session),
 * continued in others (one session per visit) and marked done in the last, which is the only one
 * that charges. Pure: the services lock the plan row and apply what these allow.
 */
interface PlanState {
  status: PlanStatus;
}

const describe = ({ status }: PlanState) => `This plan is ${status.replace('_', ' ')}`;

/** Continue today, or undo this visit's session: only work that is in progress. */
export function assertInProgress(plan: PlanState): void {
  if (plan.status !== 'in_progress') throw new PlanNotInProgressError(describe(plan));
}

/** Perform now (a planned plan) or Mark done (one in progress), and cancel: any open plan. */
export function assertOpen(plan: PlanState): void {
  if (plan.status !== 'planned' && plan.status !== 'in_progress') {
    throw new PlanNotOpenError(describe(plan));
  }
}

/**
 * Where a plan goes back to when a step is undone — a session removed, or the service that marked
 * it done removed (live, or by an amendment): still `in_progress` while any session remains, else
 * `planned`, as if it had never been started.
 */
export function statusWithSessions(remainingSessions: number): 'in_progress' | 'planned' {
  return remainingSessions > 0 ? 'in_progress' : 'planned';
}
