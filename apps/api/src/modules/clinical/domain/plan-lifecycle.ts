import type { PlanStatus } from '@dcm/contracts';
import {
  PlanAcceptanceLockedError,
  PlanNotInProgressError,
  PlanNotOpenError,
} from './visit-errors';

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

/** A plan's acceptance by the patient (feature 10, ADR-0045): proposed until accepted. */
interface PlanAcceptance extends PlanState {
  acceptedAt: Date | null;
  acceptedBy: string | null;
}

/**
 * What accepting or withdrawing changes: nothing when the plan is already so. Accepting needs an
 * open plan (409 `plan.not_open`); withdrawing a plan that is still only planned (409
 * `plan.acceptance_locked`): once work has begun it was agreed to.
 */
export function acceptancePatch(
  plan: PlanAcceptance,
  accepted: boolean,
  actor: { userId: string; now: Date },
): Pick<PlanAcceptance, 'acceptedAt' | 'acceptedBy'> | null {
  if (accepted === (plan.acceptedAt !== null)) return null;
  if (accepted) {
    assertOpen(plan);
    return { acceptedAt: actor.now, acceptedBy: actor.userId };
  }
  if (plan.status !== 'planned') {
    throw new PlanAcceptanceLockedError(`${describe(plan)}; its acceptance stands`);
  }
  return { acceptedAt: null, acceptedBy: null };
}

/**
 * Starting or performing a plan the patient has not formally accepted accepts it, by whoever
 * does the work: the fields to write with the start or the perform, or nothing.
 */
export function acceptedByWork(
  plan: PlanAcceptance,
  actor: { userId: string; now: Date },
): Partial<Pick<PlanAcceptance, 'acceptedAt' | 'acceptedBy'>> {
  return plan.acceptedAt === null ? { acceptedAt: actor.now, acceptedBy: actor.userId } : {};
}

/**
 * What undoing work does to the acceptance: when the plan goes back to `planned` and its
 * acceptance was the one that work recorded (`acceptedByWork`: same instant as the work that is
 * being undone), the acceptance is undone with it. One the patient gave before stands.
 */
export function acceptanceAfterUndo(
  plan: Pick<PlanAcceptance, 'acceptedAt'>,
  status: PlanStatus,
  workAt: Date | null,
): Partial<Pick<PlanAcceptance, 'acceptedAt' | 'acceptedBy'>> {
  const byThatWork =
    plan.acceptedAt !== null && workAt !== null && plan.acceptedAt.getTime() === workAt.getTime();
  return status === 'planned' && byThatWork ? { acceptedAt: null, acceptedBy: null } : {};
}

/**
 * Where a plan goes back to when a step is undone — a session removed, or the service that marked
 * it done removed (live, or by an amendment): still `in_progress` while any session remains, else
 * `planned`, as if it had never been started.
 */
export function statusWithSessions(remainingSessions: number): 'in_progress' | 'planned' {
  return remainingSessions > 0 ? 'in_progress' : 'planned';
}
