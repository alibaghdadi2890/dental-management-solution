import {
  type FollowUpInvalidReason,
  followUpExpiresOn,
  followUpOverdueDays,
  type FollowUpStatus,
  type PlanStatus,
} from '@dcm/contracts';

export interface FollowUpFacts {
  status: FollowUpStatus;
  dueOn: string | null;
  windowFrom: string;
}

/** What a follow-up reads as today: its expiry is derived, so Settings applies at once. */
export function deriveFollowUp(
  followUp: FollowUpFacts,
  windowDays: number,
  today: string,
): { expiresOn: string; expired: boolean; overdueDays: number } {
  const expiresOn = followUpExpiresOn(followUp.windowFrom, windowDays);
  const awaiting = followUp.status === 'awaiting';
  return {
    expiresOn,
    expired: awaiting && today > expiresOn,
    overdueDays: awaiting ? followUpOverdueDays(followUp.dueOn, today) : 0,
  };
}

/** Reopening never moves the window back; a later date gives it a fresh window (G7). */
export function reopenedWindowFrom(windowFrom: string, today: string): string {
  return today > windowFrom ? today : windowFrom;
}

/** The worklist's order (A16): overdue first, then by due date, no due date last. */
export function compareWorklist(
  a: { dueOn: string | null; createdAt: Date },
  b: { dueOn: string | null; createdAt: Date },
): number {
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  }
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/** G20: the plan item behind a follow-up may have moved on since. */
export function invalidReasonOf(statuses: readonly PlanStatus[]): FollowUpInvalidReason | null {
  if (statuses.length === 0) return null;
  if (statuses.some((status) => status === 'planned' || status === 'in_progress')) return null;
  return statuses.some((status) => status === 'cancelled') ? 'plan_cancelled' : 'plan_done';
}
