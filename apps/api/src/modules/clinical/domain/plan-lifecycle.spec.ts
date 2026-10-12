import { PLAN_STATUSES, type PlanStatus } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  acceptanceAfterUndo,
  acceptancePatch,
  acceptedByWork,
  assertInProgress,
  assertOpen,
  statusWithSessions,
} from './plan-lifecycle';
import {
  PlanAcceptanceLockedError,
  PlanNotInProgressError,
  PlanNotOpenError,
} from './visit-errors';

const allowed = (check: (plan: { status: PlanStatus }) => void) =>
  PLAN_STATUSES.filter((status) => {
    try {
      check({ status });
      return true;
    } catch {
      return false;
    }
  });

describe('plan lifecycle (ADR-0032)', () => {
  it('continues, or undoes a session of, only work in progress (409 plan.not_in_progress)', () => {
    expect(allowed(assertInProgress)).toEqual(['in_progress']);
    expect(() => {
      assertInProgress({ status: 'planned' });
    }).toThrow(PlanNotInProgressError);
    expect(() => {
      assertInProgress({ status: 'performed' });
    }).toThrow(PlanNotInProgressError);
  });

  it('performs, marks done and cancels any open plan (409 plan.not_open otherwise)', () => {
    expect(allowed(assertOpen)).toEqual(['planned', 'in_progress']);
    expect(() => {
      assertOpen({ status: 'performed' });
    }).toThrow(PlanNotOpenError);
    expect(() => {
      assertOpen({ status: 'cancelled' });
    }).toThrow(PlanNotOpenError);
  });

  it('an undone step leaves the plan in progress while a session remains, else planned', () => {
    expect(statusWithSessions(2)).toBe('in_progress');
    expect(statusWithSessions(1)).toBe('in_progress');
    expect(statusWithSessions(0)).toBe('planned');
  });
});

describe('plan acceptance (ADR-0045)', () => {
  const actor = { userId: 'user-1', now: new Date('2026-06-10T09:00:00Z') };
  const proposed = { status: 'planned', acceptedAt: null, acceptedBy: null } as const;
  const accepted = { ...proposed, acceptedAt: actor.now, acceptedBy: 'user-0' };

  it('accepts an open plan and withdraws only while it is still planned', () => {
    expect(acceptancePatch(proposed, true, actor)).toEqual({
      acceptedAt: actor.now,
      acceptedBy: 'user-1',
    });
    expect(acceptancePatch(accepted, false, actor)).toEqual({ acceptedAt: null, acceptedBy: null });
    expect(() => acceptancePatch({ ...accepted, status: 'in_progress' }, false, actor)).toThrow(
      PlanAcceptanceLockedError,
    );
    expect(() => acceptancePatch({ ...proposed, status: 'cancelled' }, true, actor)).toThrow(
      PlanNotOpenError,
    );
  });

  it('changes nothing when the plan is already so', () => {
    expect(acceptancePatch(accepted, true, actor)).toBeNull();
    expect(acceptancePatch(proposed, false, actor)).toBeNull();
    // Even on a plan that is done: nothing is asked of it.
    expect(acceptancePatch({ ...proposed, status: 'performed' }, false, actor)).toBeNull();
  });

  it('accepts a plan that work begins on, and keeps an earlier acceptance', () => {
    expect(acceptedByWork(proposed, actor)).toEqual({
      acceptedAt: actor.now,
      acceptedBy: 'user-1',
    });
    expect(acceptedByWork(accepted, actor)).toEqual({});
  });

  it('undoes with the work the acceptance that work recorded, and no other', () => {
    const at = new Date('2026-10-10T09:00:00.000Z');
    const byWork = { acceptedAt: new Date(at) };
    expect(acceptanceAfterUndo(byWork, 'planned', at)).toEqual({
      acceptedAt: null,
      acceptedBy: null,
    });
    // Earlier sessions remain: the work, and its acceptance, stand.
    expect(acceptanceAfterUndo(byWork, 'in_progress', at)).toEqual({});
    // Accepted by the patient before the work.
    const earlier = { acceptedAt: new Date('2026-10-01T09:00:00.000Z') };
    expect(acceptanceAfterUndo(earlier, 'planned', at)).toEqual({});
    expect(acceptanceAfterUndo({ acceptedAt: null }, 'planned', at)).toEqual({});
  });
});
