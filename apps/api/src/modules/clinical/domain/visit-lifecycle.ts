import type { VisitStatus } from '@dcm/contracts';
import { IllegalVisitTransitionError, VisitNotLiveError } from './visit-errors';

/** The statuses in which a visit can still change (and holds its room, spec W1). */
export const LIVE_VISIT_STATUSES = ['in_progress', 'paused'] as const satisfies VisitStatus[];

export type VisitAction = 'pause' | 'resume' | 'complete' | 'discard';

const NEXT: Record<VisitStatus, Partial<Record<VisitAction, VisitStatus>>> = {
  in_progress: { pause: 'paused', complete: 'completed', discard: 'discarded' },
  paused: { resume: 'in_progress', complete: 'completed', discard: 'discarded' },
  completed: {},
  discarded: {},
};

export function isLive(status: VisitStatus): boolean {
  return (LIVE_VISIT_STATUSES as readonly VisitStatus[]).includes(status);
}

/**
 * The visit state machine (spec §Domain rules): `in_progress ⇄ paused`, and either live status
 * → `completed` or `discarded`. Strict: a same-state pause or resume throws here too; the service
 * decides that those are idempotent no-ops rather than asking the state machine. Whether a discard
 * is allowed also depends on the visit being empty, which is `discard-rule.ts`'s job.
 *
 * @throws VisitNotLiveError from `completed` or `discarded` (409 `visit.not_live`).
 * @throws IllegalVisitTransitionError for any other action the status doesn't allow.
 */
export function transition(status: VisitStatus, action: VisitAction): VisitStatus {
  if (!isLive(status)) {
    throw new VisitNotLiveError(`Visit is ${status}; cannot ${action}`);
  }
  const next = NEXT[status][action];
  if (!next) {
    throw new IllegalVisitTransitionError(`Visit is ${status}; cannot ${action}`);
  }
  return next;
}
