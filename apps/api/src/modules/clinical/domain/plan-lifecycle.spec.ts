import { PLAN_STATUSES, type PlanStatus } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { assertInProgress, assertOpen, statusWithSessions } from './plan-lifecycle';
import { PlanNotInProgressError, PlanNotOpenError } from './visit-errors';

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
