import type { DiagnosisRecord, HistoryService, PatientChart, TreatmentPlan } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { buildThreads, matchesFilter } from './build-threads';

const V1 = '0192f3a0-0000-7000-8000-000000000101';
const V2 = '0192f3a0-0000-7000-8000-000000000102';
const usd = (amount: string) => ({ amount, currency: 'USD' });

const diagnosis = (id: string, extra: Partial<DiagnosisRecord> = {}) =>
  ({
    id,
    toothCode: '36',
    jaw: null,
    surfaces: ['O'],
    name: 'Caries',
    status: 'active',
    dentistName: 'Dr. Reyes',
    recordedInVisitId: V1,
    recordedDate: '2026-08-12',
    resolvedInVisitId: null,
    resolvedAt: null,
    ...extra,
  }) as DiagnosisRecord;

const plan = (id: string, extra: Partial<TreatmentPlan> = {}) =>
  ({
    id,
    toothCode: '36',
    jaw: null,
    surfaces: ['O'],
    name: 'Composite',
    status: 'planned',
    dentistName: 'Dr. Reyes',
    diagnosisRecordId: null,
    recordedInVisitId: V1,
    recordedAt: '2026-08-12T09:10:00.000Z',
    groupId: null,
    startedInVisitId: null,
    startedAt: null,
    sessions: [],
    performedInVisitId: null,
    performedAt: null,
    cancelledInVisitId: null,
    cancelledAt: null,
    price: usd('120.00'),
    ...extra,
  }) as TreatmentPlan;

const service = (id: string, extra: Partial<HistoryService> = {}): HistoryService => ({
  id,
  visitId: V2,
  visitDate: '2026-09-01',
  dentistName: 'Dr. Reyes',
  code: 'SCL',
  name: 'Scaling',
  toothCode: null,
  jaw: null,
  surfaces: [],
  final: usd('40.00'),
  planId: null,
  ...extra,
});

const chart = (extra: Partial<PatientChart>) =>
  ({
    diagnoses: [],
    plans: [],
    history: [],
    voidedVisitIds: [],
    ...extra,
  }) as unknown as PatientChart;

describe('buildThreads', () => {
  it('links a diagnosis to its plan and flags one with no plan', () => {
    const threads = buildThreads(
      chart({
        diagnoses: [diagnosis('d1'), diagnosis('d2', { toothCode: '46', name: 'Fracture' })],
        plans: [plan('p1', { diagnosisRecordId: 'd1' })],
      }),
    );
    expect(threads.needsAttention.map((thread) => [thread.id, thread.needsPlan])).toEqual([
      ['d1', false],
      ['d2', true],
    ]);
    expect(threads.needsAttention[0]?.steps.map((step) => step.kind)).toEqual([
      'diagnosed',
      'planned',
    ]);
  });

  it('puts resolved diagnoses and performed plans under completed, steps in time order', () => {
    const threads = buildThreads(
      chart({
        diagnoses: [
          diagnosis('d1', {
            status: 'resolved',
            resolvedInVisitId: V2,
            resolvedAt: '2026-09-01T10:00:00.000Z',
          }),
        ],
        plans: [
          plan('p1', {
            diagnosisRecordId: 'd1',
            status: 'performed',
            performedInVisitId: V2,
            performedAt: '2026-09-01T09:30:00.000Z',
          }),
        ],
      }),
    );
    expect(threads.needsAttention).toEqual([]);
    expect(threads.completed[0]?.steps.map((step) => step.kind)).toEqual([
      'diagnosed',
      'planned',
      'performed',
      'resolved',
    ]);
    expect(matchesFilter(threads.completed[0]!, 'resolved')).toBe(true);
  });

  it('keeps a plan without a diagnosis as its own thread', () => {
    const threads = buildThreads(chart({ plans: [plan('p1')] }));
    expect(threads.needsAttention.map((thread) => [thread.id, thread.title])).toEqual([
      ['p1', 'Composite'],
    ]);
    expect(matchesFilter(threads.needsAttention[0]!, 'planned')).toBe(true);
  });

  it('marks steps from a voided visit', () => {
    const threads = buildThreads(chart({ diagnoses: [diagnosis('d1')], voidedVisitIds: [V1] }));
    expect(threads.needsAttention[0]?.steps[0]).toMatchObject({ kind: 'diagnosed', voided: true });
  });

  it('groups services performed without a plan by tooth, jaw-level last', () => {
    const threads = buildThreads(
      chart({
        history: [
          service('s1'),
          service('s2', { toothCode: '21', name: 'Whitening' }),
          service('s3', { toothCode: '36', planId: 'p1' }),
        ],
      }),
    );
    expect(
      threads.unplanned.map((group) => [group.toothCode, group.services.map((s) => s.id)]),
    ).toEqual([
      ['21', ['s2']],
      [null, ['s1']],
    ]);
  });
});
