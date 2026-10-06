import type { TreatmentPlan } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { unfinishedActions, unfinishedInVisit, unfinishedWork } from './unfinished';

const plan = (id: string, status: TreatmentPlan['status'], visits: string[], amount = '100.00') =>
  ({
    id,
    status,
    price: { amount, currency: 'USD' },
    sessions: visits.map((visitId) => ({ visitId, date: '2026-09-01', note: null })),
  }) as TreatmentPlan;

describe('unfinished work', () => {
  const plans = [
    plan('planned', 'planned', []),
    plan('earlier', 'in_progress', ['v1'], '220.00'),
    plan('continued', 'in_progress', ['v1', 'v2'], '350.00'),
    plan('new', 'in_progress', ['v2'], '30.00'),
    plan('done', 'performed', ['v1', 'v2']),
  ];

  it('splits work in progress by whether this visit worked on it, and totals all of it', () => {
    const work = unfinishedWork(plans, 'v2');
    expect(work.toContinue.map(({ id }) => id)).toEqual(['earlier']);
    expect(work.workedHere.map(({ id }) => id)).toEqual(['continued', 'new']);
    expect(work.carried).toEqual({ amount: '600.00', currency: 'USD' });
  });

  it('on the patient record everything waits, and nothing means no total', () => {
    expect(unfinishedWork(plans, null).toContinue).toHaveLength(3);
    expect(unfinishedWork([plan('planned', 'planned', [])], 'v2').carried).toBeNull();
  });

  it('lists what a visit worked on without finishing it', () => {
    const completedLater = {
      ...plan('later', 'performed', ['v1', 'v2']),
      performedInVisitId: 'v3',
    };
    const completedHere = { ...plan('here', 'performed', ['v1', 'v2']), performedInVisitId: 'v2' };
    const lines = unfinishedInVisit([...plans.slice(0, 4), completedLater, completedHere], 'v2');
    expect(lines.map(({ plan: { id }, session }) => [id, session])).toEqual([
      ['continued', 2],
      ['new', 1],
      ['later', 2],
    ]);
  });

  it('offers actions by where the service is shown', () => {
    const visit = { kind: 'visit', visitId: 'v2' } as const;
    const [, earlier, continued, added] = plans as [
      TreatmentPlan,
      TreatmentPlan,
      TreatmentPlan,
      TreatmentPlan,
    ];
    expect(unfinishedActions(earlier, visit)).toEqual(['continue', 'cancel']);
    expect(unfinishedActions(continued, visit)).toEqual(['complete', 'notToday']);
    expect(unfinishedActions(added, visit)).toEqual(['complete', 'remove']);
    expect(unfinishedActions(continued, { kind: 'patient' })).toEqual(['cancel']);
  });
});
