import type { VisitStatus } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { correct, isLive, transition, type VisitAction } from './visit-lifecycle';
import {
  IllegalVisitTransitionError,
  VisitNotAmendableError,
  VisitNotLiveError,
  VisitNotVoidableError,
} from './visit-errors';

describe('transition', () => {
  it.each<[VisitStatus, VisitAction, VisitStatus]>([
    ['in_progress', 'pause', 'paused'],
    ['paused', 'resume', 'in_progress'],
    ['in_progress', 'complete', 'completed'],
    ['paused', 'complete', 'completed'],
    ['in_progress', 'discard', 'discarded'],
    ['paused', 'discard', 'discarded'],
  ])('%s --%s--> %s', (from, action, to) => {
    expect(transition(from, action)).toBe(to);
  });

  it.each<[VisitStatus, VisitAction]>([
    ['completed', 'pause'],
    ['completed', 'resume'],
    ['completed', 'complete'],
    ['completed', 'discard'],
    ['discarded', 'pause'],
    ['discarded', 'resume'],
    ['discarded', 'complete'],
    ['discarded', 'discard'],
  ])('refuses %s --%s--> as not live', (from, action) => {
    expect(() => transition(from, action)).toThrow(VisitNotLiveError);
    expect(() => transition(from, action)).toThrow(IllegalVisitTransitionError);
  });

  it.each<[VisitStatus, VisitAction]>([
    ['in_progress', 'resume'],
    ['paused', 'pause'],
  ])('is strict about a same-state %s --%s-->: the service decides idempotency', (from, action) => {
    let thrown: unknown;
    try {
      transition(from, action);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IllegalVisitTransitionError);
    expect(thrown).not.toBeInstanceOf(VisitNotLiveError);
    expect((thrown as IllegalVisitTransitionError).code).toBe('visit.illegal_transition');
  });
});

describe('isLive', () => {
  it.each<[VisitStatus, boolean]>([
    ['in_progress', true],
    ['paused', true],
    ['completed', false],
    ['discarded', false],
  ])('%s → %s', (status, live) => {
    expect(isLive(status)).toBe(live);
  });
});

describe('correct', () => {
  it.each<[VisitStatus, 'amend' | 'void', VisitStatus]>([
    ['completed', 'amend', 'amended'],
    ['amended', 'amend', 'amended'],
    ['completed', 'void', 'voided'],
    ['amended', 'void', 'voided'],
  ])('%s --%s--> %s', (from, correction, to) => {
    expect(correct(from, correction)).toBe(to);
  });

  it.each<VisitStatus>(['in_progress', 'paused', 'discarded', 'voided'])(
    'refuses to amend or void a %s visit',
    (from) => {
      expect(() => correct(from, 'amend')).toThrow(VisitNotAmendableError);
      expect(() => correct(from, 'void')).toThrow(VisitNotVoidableError);
    },
  );
});
