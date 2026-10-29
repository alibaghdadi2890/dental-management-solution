import type { TreatmentPlan } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { unfinishedActions, unfinishedInVisit, unfinishedWork } from './unfinished';

const plan = (id: string, status: TreatmentPlan['status'], visits: string[], amount = '100.00') =>
  ({
    id,
    status,
    price: { amount, currency: 'USD' },
    sessions: visits.map((visitId) => ({ visitId, date: '2026-09-01', note: null })),
    chargedIn: null,
  }) as TreatmentPlan;

describe('unfinished work', () => {
  const plans = [
    plan('planned', 'planned', []),
    plan('earlier', 'in_progress', ['v1'], '220.00'),
    plan('continued', 'in_progress', ['v1', 'v2'], '350.00'),
    plan('new', 'in_progress', ['v2'], '30.00'),
    plan('done', 'performed', ['v1', 'v2']),
  ];

  it('splits work in progress by whether this visit worked on it, and totals what nothing charges yet', () => {
    const work = unfinishedWork(plans, 'v2');
    expect(work.toContinue.map(({ id }) => id)).toEqual(['earlier']);
    expect(work.workedHere.map(({ id }) => id)).toEqual(['continued', 'new']);
    expect(work.carried).toEqual({ amount: '600.00', currency: 'USD' });
    // Work charged at its start is carried by nobody (ADR-0064).
    const charged = plans.map((item) =>
      item.id === 'earlier' ? { ...item, chargedIn: { visitId: 'v1', number: 1 } } : item,
    );
    expect(unfinishedWork(charged, 'v2').carried).toEqual({ amount: '380.00', currency: 'USD' });
  });

  it('lists work completed here that an earlier visit charged', () => {
    const completed = {
      ...plan('crown', 'performed', ['v1']),
      performedInVisitId: 'v2',
      chargedIn: { visitId: 'v1', number: 1 },
    };
    const oneGo = {
      ...plan('filling', 'performed', []),
      performedInVisitId: 'v2',
      chargedIn: { visitId: 'v2', number: 2 },
    };
    expect(unfinishedWork([completed, oneGo], 'v2').completedHere).toEqual([completed]);
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
    const chargedEarlier = {
      ...plan('charged', 'performed', ['v1']),
      performedInVisitId: 'v2',
      chargedIn: { visitId: 'v1', number: 1 },
    };
    const startedHere = {
      ...plan('started', 'in_progress', ['v2']),
      chargedIn: { visitId: 'v2', number: 2 },
    };
    const lines = unfinishedInVisit(
      [...plans.slice(0, 4), completedLater, completedHere, chargedEarlier, startedHere],
      'v2',
    );
    expect(lines.map(({ plan: { id }, session, part }) => [id, session, part])).toEqual([
      ['continued', 2, 'session'],
      ['new', 1, 'session'],
      ['later', 2, 'session'],
      ['charged', 0, 'completed'],
      ['started', 1, 'charged'],
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
