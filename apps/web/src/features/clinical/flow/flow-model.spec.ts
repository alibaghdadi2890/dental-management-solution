import { describe, expect, it } from 'vitest';
import {
  chart,
  diagnosisRecord,
  OLDER_VISIT_ID,
  presenceRecord,
  treatmentPlan,
  visit,
  VISIT_ID,
  visitService,
} from '../workspace/workspace.test-utils';
import { inTodaysPlan, openFromBefore, otherPlans, proposals, recordedToday } from './proposals';
import { thisVisitSummary } from './this-visit-summary';
import { sessionNumberIn, visitFlowFacts } from './visit-facts';
import { todayPhases, worklistItems } from './worklist';

const session = (visitId: string, date = '2026-09-04') => ({ visitId, date, note: null });
const OLD = { recordedInVisitId: OLDER_VISIT_ID };

describe('visitFlowFacts', () => {
  it('counts only what this visit holds', () => {
    const facts = visitFlowFacts(
      visit({
        reason: ' Broken filling ',
        historyConfirmation: { at: '2026-09-04T09:04:00.000Z', by: VISIT_ID, byName: 'Dr. Ana' },
        worklist: [
          { planId: treatmentPlan(30, 'Crown', '16').id },
          { planId: treatmentPlan(32, 'Root canal', '26').id },
          { planId: treatmentPlan(34, 'Filling', '24').id },
        ],
        services: [
          visitService(50, 'Examination', null, { autoAdded: true }),
          visitService(52, 'Composite', '24'),
        ],
      }),
      chart({
        diagnoses: [
          diagnosisRecord(10, 'Caries', '24'),
          diagnosisRecord(12, 'Attrition', '26', OLD),
        ],
        plans: [
          treatmentPlan(30, 'Crown', '16', OLD),
          // Continued here, not finished.
          treatmentPlan(32, 'Root canal', '26', {
            ...OLD,
            status: 'in_progress',
            sessions: [session(OLDER_VISIT_ID, '2026-08-01'), session(VISIT_ID)],
          }),
          treatmentPlan(34, 'Filling', '24', OLD),
          treatmentPlan(36, 'Composite', '24'),
          treatmentPlan(38, 'Veneer', '11', { status: 'cancelled' }),
        ],
        presence: [
          presenceRecord(60, '18', 'missing'),
          presenceRecord(61, '36', 'missing', { serviceId: VISIT_ID }),
          presenceRecord(62, '48', 'missing', { visitId: OLDER_VISIT_ID }),
        ],
      }),
      2,
    );
    expect(facts).toEqual({
      historyConfirmed: true,
      hasReason: true,
      hasComplaint: false,
      diagnoses: 1,
      presenceChanges: 1,
      files: 2,
      plans: 1,
      // Continued; the two others are only on the list.
      worklistTouched: 1,
      // One service that was not added automatically, and one session.
      work: 2,
    });
  });

  it('knows only the visit before the chart loads', () => {
    expect(visitFlowFacts(visit({ painScore: 0 }), undefined, 0)).toMatchObject({
      hasComplaint: true,
      hasReason: false,
      diagnoses: 0,
      work: 0,
    });
  });

  it('numbers a session by the visit that logged it, else as the next one', () => {
    const plan = treatmentPlan(32, 'Root canal', '26', {
      sessions: [session(OLDER_VISIT_ID), session(VISIT_ID)],
    });
    expect(sessionNumberIn(plan, VISIT_ID)).toBe(2);
    expect(sessionNumberIn(plan, 'another')).toBe(3);
  });
});

describe('worklistItems', () => {
  it('says where each planned item stands, in the order picked', () => {
    const plans = [
      treatmentPlan(30, 'Crown', '16', OLD),
      treatmentPlan(32, 'Root canal', '26', {
        ...OLD,
        status: 'in_progress',
        sessions: [session(OLDER_VISIT_ID), session(VISIT_ID)],
      }),
      treatmentPlan(34, 'Filling', '24', {
        ...OLD,
        status: 'performed',
        performedInVisitId: VISIT_ID,
      }),
      treatmentPlan(36, 'Extraction', '48', OLD),
      treatmentPlan(38, 'Veneer', '11', { ...OLD, status: 'cancelled' }),
    ];
    const items = worklistItems(
      visit({
        worklist: [
          { planId: plans[3]!.id },
          { planId: plans[1]!.id },
          { planId: plans[2]!.id },
          { planId: plans[0]!.id },
          { planId: plans[4]!.id },
          { planId: VISIT_ID },
        ],
      }),
      chart({ plans }),
    );
    expect(items.map((item) => [item.plan.name, item.state, item.continuing])).toEqual([
      ['Extraction', 'open', false],
      ['Root canal', 'unfinished', true],
      ['Filling', 'completed', false],
      ['Crown', 'open', false],
    ]);
  });
});

describe('todayPhases', () => {
  it('lists the open plan by priority with what is on today’s list, and what this visit did', () => {
    const crown = treatmentPlan(30, 'Crown', '16', { ...OLD, priority: 'urgent' });
    const rootCanal = treatmentPlan(32, 'Root canal', '26', {
      ...OLD,
      status: 'in_progress',
      sessions: [session(OLDER_VISIT_ID)],
    });
    const doneHere = treatmentPlan(34, 'Filling', '24', {
      ...OLD,
      status: 'performed',
      performedInVisitId: VISIT_ID,
    });
    const doneBefore = treatmentPlan(36, 'Sealant', '25', {
      ...OLD,
      status: 'performed',
      performedInVisitId: OLDER_VISIT_ID,
    });
    const whitening = treatmentPlan(38, 'Whitening', null, { ...OLD, priority: 'elective' });
    const phases = todayPhases(
      visit({ worklist: [{ planId: rootCanal.id }, { planId: doneHere.id }] }),
      chart({ plans: [crown, rootCanal, doneHere, doneBefore, whitening] }),
    );
    expect(
      phases.map((phase) => [
        phase.priority,
        phase.rows.map((row) => [row.plan.name, row.listed, row.state]),
      ]),
    ).toEqual([
      ['urgent', [['Crown', false, 'open']]],
      [
        'high',
        [
          ['Root canal', true, 'open'],
          ['Filling', true, 'completed'],
        ],
      ],
      ['elective', [['Whitening', false, 'open']]],
    ]);
    // Nothing open and nothing done here: no phase at all.
    expect(todayPhases(visit(), chart({ plans: [doneBefore] }))).toEqual([]);
  });
});

describe('proposals', () => {
  const today = diagnosisRecord(10, 'Deep caries', '24');
  const attrition = diagnosisRecord(12, 'Attrition', '26', OLD);
  const planned = diagnosisRecord(14, 'Fracture', '16', OLD);
  const resolved = diagnosisRecord(16, 'Abscess', '36', { ...OLD, status: 'resolved' });
  const base = chart({
    diagnoses: [today, attrition, planned, resolved],
    plans: [treatmentPlan(30, 'Crown', '16', { ...OLD, diagnosisRecordId: planned.id })],
  });

  it('splits the findings into today’s and what is open from before without a plan', () => {
    expect(recordedToday(base, VISIT_ID).map((record) => record.name)).toEqual(['Deep caries']);
    expect(openFromBefore(base, VISIT_ID).map((record) => record.name)).toEqual(['Attrition']);
  });

  it('gives one card per diagnosis of today, and per older one carried', () => {
    expect(proposals(base, VISIT_ID, new Set()).map((card) => card.record.name)).toEqual([
      'Deep caries',
    ]);
    const carried = new Set([attrition.id]);
    expect(
      proposals(base, VISIT_ID, carried).map((card) => [card.record.name, card.isNew]),
    ).toEqual([
      ['Deep caries', true],
      ['Attrition', false],
    ]);
    expect(inTodaysPlan(base, attrition, carried)).toBe(true);
    expect(inTodaysPlan(base, attrition, new Set())).toBe(false);
  });

  it('keeps a carried diagnosis as one card once this visit planned its treatment', () => {
    const crown = treatmentPlan(40, 'Onlay', '26', { diagnosisRecordId: attrition.id });
    const after = { ...base, plans: [...base.plans, crown] };
    // Planned here: still listed under "Open from before", as in today's plan — carried or not.
    expect(openFromBefore(after, VISIT_ID).map((record) => record.name)).toEqual(['Attrition']);
    for (const carried of [new Set<string>(), new Set([attrition.id])]) {
      const cards = proposals(after, VISIT_ID, carried);
      expect(cards.map((card) => card.record.name)).toEqual(['Deep caries', 'Attrition']);
      expect(cards[1]?.plans.map((plan) => plan.name)).toEqual(['Onlay']);
    }
  });
});

describe('otherPlans', () => {
  it('lists this visit’s open plans that are on no diagnosis card', () => {
    const caries = diagnosisRecord(10, 'Deep caries', '24');
    const filling = treatmentPlan(30, 'Filling', '24', { diagnosisRecordId: caries.id });
    const implant = treatmentPlan(32, 'Implant', '36');
    const whitening = treatmentPlan(34, 'Whitening', null);
    const older = treatmentPlan(36, 'Night guard', null, OLD);
    const dropped = treatmentPlan(38, 'Veneer', '11', { status: 'cancelled' });
    const charted = chart({
      diagnoses: [caries],
      plans: [filling, implant, whitening, older, dropped],
    });
    const cards = proposals(charted, VISIT_ID, new Set());
    expect(otherPlans(charted, VISIT_ID, cards).map((plan) => plan.name)).toEqual([
      'Implant',
      'Whitening',
    ]);
  });
});

describe('thisVisitSummary', () => {
  it('reads the four parts and what the next visit is for', () => {
    const rootCanal = treatmentPlan(32, 'Root canal treatment', '26', {
      ...OLD,
      status: 'in_progress',
      sessions: [session(OLDER_VISIT_ID), session(VISIT_ID)],
    });
    const summary = thisVisitSummary(
      visit({
        services: [visitService(50, 'Examination', null, { autoAdded: true })],
        money: { subtotal: '25.00', discount: '0.00', total: '25.00', capped: false },
      }),
      chart({
        diagnoses: [
          diagnosisRecord(10, 'Deep caries', '24'),
          diagnosisRecord(12, 'Attrition', '26', OLD),
        ],
        plans: [
          treatmentPlan(30, 'Crown', '16', { ...OLD, priority: 'urgent' }),
          rootCanal,
          treatmentPlan(36, 'Composite', '24', { price: { amount: '50.00', currency: 'USD' } }),
        ],
      }),
    );
    expect(summary.recorded.map((record) => record.name)).toEqual(['Deep caries']);
    expect(summary.planned.plans.map((plan) => plan.name)).toEqual(['Composite']);
    expect(summary.planned.total).toEqual({ amount: '50.00', currency: 'USD' });
    expect(summary.done).toEqual({ count: 1, total: { amount: '25.00', currency: 'USD' } });
    expect(summary.continues).toEqual([{ plan: rootCanal, session: 2 }]);
    // Work in progress comes back before the urgent crown.
    expect(summary.next).toEqual({ kind: 'continue', plan: rootCanal });
    expect(summary.empty).toBe(false);
  });

  it('is empty for a visit that recorded nothing, and points at the first urgent item', () => {
    const crown = treatmentPlan(30, 'Crown', '16', { ...OLD, priority: 'urgent' });
    const summary = thisVisitSummary(
      visit(),
      chart({ plans: [treatmentPlan(31, 'Whitening', null, OLD), crown] }),
    );
    expect(summary.empty).toBe(true);
    expect(summary.next).toEqual({ kind: 'urgent', plan: crown });
    expect(thisVisitSummary(visit(), chart()).next).toBeNull();
  });
});
