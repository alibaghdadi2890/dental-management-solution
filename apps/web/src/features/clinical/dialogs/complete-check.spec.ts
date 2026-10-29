import { describe, expect, it } from 'vitest';
import {
  chart,
  diagnosisRecord,
  OLDER_VISIT_ID,
  treatmentPlan,
  visit,
  VISIT_ID,
  visitService,
} from '../workspace/workspace.test-utils';
import { checkDecisions, completeCheck, workToFinish } from './complete-check';

const here = { visitId: VISIT_ID, date: '2026-08-08', note: null };
const before = { visitId: OLDER_VISIT_ID, date: '2026-08-01', note: null };

describe('workToFinish', () => {
  it('asks about hand-added services and work in progress here, each with its default', () => {
    const rootCanal = treatmentPlan(30, 'Root canal treatment', '26', {
      status: 'in_progress',
      sessions: [here],
      estimatedSessions: 3,
    });
    const lastSession = treatmentPlan(32, 'Crown prep', '16', {
      status: 'in_progress',
      sessions: [before, here],
      estimatedSessions: 2,
    });
    const noEstimate = treatmentPlan(34, 'Bridge', '36', {
      status: 'in_progress',
      sessions: [here],
    });
    const elsewhere = treatmentPlan(36, 'Implant', '46', {
      status: 'in_progress',
      sessions: [before],
    });
    const done = treatmentPlan(38, 'Composite', '11', {
      status: 'performed',
      performedInVisitId: VISIT_ID,
    });
    const services = [
      visitService(20, 'X-ray', '26'),
      visitService(22, 'Examination', null, { autoAdded: true }),
      visitService(24, 'Composite', '11', { planId: done.id }),
      visitService(26, 'Root canal treatment', '26', { planId: rootCanal.id }),
    ];
    expect(
      workToFinish(
        visit({ services }),
        chart({ plans: [rootCanal, lastSession, noEstimate, elsewhere, done] }),
      ).map((item) => [item.name, item.kind, item.session, item.suggested]),
    ).toEqual([
      ['X-ray', 'service', null, 'finished'],
      ['Root canal treatment', 'plan', 1, 'continues'],
      ['Crown prep', 'plan', 2, 'finished'],
      ['Bridge', 'plan', 1, 'continues'],
    ]);
  });
});

describe('completeCheck', () => {
  const caries = diagnosisRecord(10, 'Deep caries', '26');
  const rootCanal = treatmentPlan(30, 'Root canal treatment', '26', {
    status: 'in_progress',
    sessions: [here],
    diagnosisRecordId: caries.id,
    chargedIn: { visitId: VISIT_ID, number: 1 },
  });
  const line = visitService(20, 'Root canal treatment', '26', { planId: rootCanal.id });
  const theVisit = visit({ services: [line] });
  const theChart = chart({ diagnoses: [caries], plans: [rootCanal] });

  it('lists the diagnosis only once the work that treats it is Finished, and ticks it', () => {
    const continues = completeCheck(theVisit, theChart);
    expect(continues.diagnoses).toEqual([]);
    const finished = completeCheck(
      theVisit,
      theChart,
      new Map([['plan:' + rootCanal.id, 'finished']]),
    );
    expect(finished.diagnoses.map((item) => item.record.name)).toEqual(['Deep caries']);
    expect([...finished.suggested]).toEqual([caries.id]);
  });

  it('leaves out a service that Continues, and what an earlier check showed', () => {
    const filling = visitService(22, 'Composite', '16');
    const decay = diagnosisRecord(12, 'Caries', '16');
    const v = visit({ services: [filling] });
    const c = chart({ diagnoses: [decay] });
    expect(completeCheck(v, c).diagnoses.map((item) => item.record.name)).toEqual(['Caries']);
    expect(
      completeCheck(v, c, new Map([['service:' + filling.id, 'continues']])).diagnoses,
    ).toEqual([]);
    const later = completeCheck(v, c, new Map(), new Set(['service:' + filling.id, decay.id]));
    expect(later.work).toEqual([]);
    expect(later.diagnoses).toEqual([]);
  });

  it('turns the answers into what changes something', () => {
    const filling = visitService(22, 'Composite', '16');
    const v = visit({ services: [filling, line] });
    const choices = new Map([
      ['plan:' + rootCanal.id, 'finished' as const],
      ['service:' + filling.id, 'continues' as const],
    ]);
    const check = completeCheck(v, theChart, choices);
    expect(checkDecisions(check, choices, (id) => check.suggested.has(id))).toEqual({
      finish: [rootCanal.id],
      unfinish: [filling.id],
      resolve: [caries.id],
    });
    expect(checkDecisions(check, new Map(), () => false)).toEqual({
      finish: [],
      unfinish: [],
      resolve: [],
    });
  });
});
