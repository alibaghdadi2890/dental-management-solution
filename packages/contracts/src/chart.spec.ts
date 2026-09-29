import { describe, expect, it } from 'vitest';
import { deriveChart } from './chart.js';
import type { DiagnosisRecord, HistoryService, TreatmentPlan } from './clinical-records.js';
import type { ToothCode } from './tooth.js';
import type { VisitService } from './visits.js';

const ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const VISIT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';
const DENTIST_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70';
const MONEY = { amount: '80.00', currency: 'USD' };

function diagnosis(
  overrides: Partial<DiagnosisRecord> & { toothCode: ToothCode },
): DiagnosisRecord {
  return {
    id: ID,
    patientId: ID,
    surfaces: [],
    diagnosisId: ID,
    code: 'K02.9',
    name: 'Dental caries',
    category: null,
    status: 'active',
    note: null,
    dentistId: DENTIST_ID,
    dentistName: 'Dr. Smith',
    recordedBy: ID,
    recordedInVisitId: VISIT_ID,
    recordedInVisitDate: '2026-09-30',
    recordedAt: '2026-09-30T10:00:00.000Z',
    resolvedInVisitId: null,
    resolvedAt: null,
    ...overrides,
  };
}

function plan(overrides: Partial<TreatmentPlan> & { toothCode: ToothCode | null }): TreatmentPlan {
  return {
    id: ID,
    patientId: ID,
    surfaces: [],
    procedureId: ID,
    code: 'D2740',
    name: 'Zircon Crown',
    category: null,
    chargeUnit: 'per_tooth',
    price: { amount: '500.00', currency: 'USD' },
    diagnosisRecordId: null,
    status: 'planned',
    note: null,
    dentistId: DENTIST_ID,
    dentistName: 'Dr. Smith',
    recordedBy: ID,
    recordedInVisitId: VISIT_ID,
    recordedAt: '2026-09-30T10:00:00.000Z',
    performedInVisitId: null,
    performedAt: null,
    cancelledInVisitId: null,
    cancelledAt: null,
    ...overrides,
  };
}

function history(
  overrides: Partial<HistoryService> & { toothCode: ToothCode | null },
): HistoryService {
  return {
    id: ID,
    visitId: VISIT_ID,
    visitDate: '2026-09-01',
    dentistName: 'Dr. Smith',
    code: 'D2140',
    name: 'Amalgam Filling',
    surfaces: [],
    final: MONEY,
    ...overrides,
  };
}

function liveService(
  overrides: Partial<VisitService> & { toothCode: ToothCode | null },
): VisitService {
  return {
    id: ID,
    procedureId: ID,
    code: 'D2140',
    name: 'Amalgam Filling',
    category: null,
    chargeUnit: 'per_tooth',
    surfaces: [],
    base: MONEY,
    discount: { amount: '0.00', currency: 'USD' },
    final: MONEY,
    planId: null,
    recordedBy: ID,
    createdAt: '2026-09-30T10:05:00.000Z',
    ...overrides,
  };
}

describe('deriveChart', () => {
  it('returns an empty map given no records', () => {
    const chart = deriveChart({ diagnoses: [], plans: [], history: [], liveServices: [] });
    expect(chart.size).toBe(0);
  });

  it('marks a tooth with an open plan as planned', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [plan({ toothCode: '16' })],
      history: [],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.state).toBe('planned');
    expect(tooth?.openPlanIds).toEqual([ID]);
    expect(tooth?.titleParts.plans).toEqual(['Zircon Crown']);
  });

  it('a whole-tooth history service tints wholeTooth as treated, and state as treated', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.wholeTooth).toBe('treated');
    expect(tooth?.state).toBe('treated');
    expect(tooth?.surfaces).toEqual({});
  });

  it('treated (history) outranks planned', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [plan({ toothCode: '16' })],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [],
    });
    expect(chart.get('16')?.state).toBe('treated');
  });

  it('treated_today (live) outranks treated (history)', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [liveService({ toothCode: '16', surfaces: [] })],
    });
    expect(chart.get('16')?.state).toBe('treated_today');
    expect(chart.get('16')?.wholeTooth).toBe('treated_today');
  });

  it('planned outranks none (no other records)', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [plan({ toothCode: '24' })],
      history: [],
      liveServices: [],
    });
    expect(chart.get('24')?.state).toBe('planned');
  });

  it('a tooth with nothing recorded is absent from the map', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [plan({ toothCode: '24' })],
      history: [],
      liveServices: [],
    });
    expect(chart.has('25')).toBe(false);
  });

  it('whole-tooth service tints wholeTooth, not the surfaces map', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.wholeTooth).toBe('treated');
    expect(tooth?.surfaces).toEqual({});
  });

  it('a surface-scoped service marks only that surface, leaving wholeTooth null', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: ['M', 'O'] })],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.wholeTooth).toBeNull();
    expect(tooth?.surfaces).toEqual({ M: 'treated', O: 'treated' });
  });

  it('a live service overrides a historic one on the same surface', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: ['M'] })],
      liveServices: [liveService({ toothCode: '16', surfaces: ['M'] })],
    });
    expect(chart.get('16')?.surfaces).toEqual({ M: 'treated_today' });
  });

  it('a live service on a different surface leaves the historic surface mark untouched', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: ['M'] })],
      liveServices: [liveService({ toothCode: '16', surfaces: ['D'] })],
    });
    expect(chart.get('16')?.surfaces).toEqual({ M: 'treated', D: 'treated_today' });
  });

  it('a performed plan does not count as planned', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [
        plan({ toothCode: '16', status: 'performed', performedAt: '2026-09-30T10:00:00.000Z' }),
      ],
      history: [],
      liveServices: [],
    });
    expect(chart.has('16')).toBe(false);
  });

  it('a cancelled plan does not count as planned', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [
        plan({ toothCode: '16', status: 'cancelled', cancelledAt: '2026-09-30T10:00:00.000Z' }),
      ],
      history: [],
      liveServices: [],
    });
    expect(chart.has('16')).toBe(false);
  });

  it('a resolved diagnosis does not set hasActiveDiagnosis', () => {
    const chart = deriveChart({
      diagnoses: [
        diagnosis({ toothCode: '16', status: 'resolved', resolvedAt: '2026-09-30T10:00:00.000Z' }),
      ],
      plans: [],
      history: [],
      liveServices: [],
    });
    expect(chart.has('16')).toBe(false);
  });

  it('an active diagnosis sets hasActiveDiagnosis and titleParts.diagnoses, without affecting state', () => {
    const chart = deriveChart({
      diagnoses: [diagnosis({ toothCode: '16' })],
      plans: [],
      history: [],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.hasActiveDiagnosis).toBe(true);
    expect(tooth?.state).toBe('none');
    expect(tooth?.titleParts.diagnoses).toEqual(['Dental caries']);
  });

  it('jaw-level history and live services (toothCode null) touch no tooth', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: null })],
      liveServices: [liveService({ toothCode: null })],
    });
    expect(chart.size).toBe(0);
  });

  it('a jaw-level plan (toothCode null) touches no tooth', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [plan({ toothCode: null })],
      history: [],
      liveServices: [],
    });
    expect(chart.size).toBe(0);
  });

  it('counts historyCount from completed services only, not live ones', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [],
      history: [
        history({ toothCode: '16', surfaces: ['M'] }),
        history({ toothCode: '16', surfaces: ['D'] }),
      ],
      liveServices: [liveService({ toothCode: '16', surfaces: ['B'] })],
    });
    const tooth = chart.get('16');
    expect(tooth?.historyCount).toBe(2);
    expect(tooth?.titleParts.historyCount).toBe(2);
  });

  it('a surface-scoped open plan marks that surface as planned', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [plan({ toothCode: '16', surfaces: ['O'] })],
      history: [],
      liveServices: [],
    });
    expect(chart.get('16')?.surfaces).toEqual({ O: 'planned' });
  });

  it('a treated surface outranks a planned mark on the same surface', () => {
    const chart = deriveChart({
      diagnoses: [],
      plans: [plan({ toothCode: '16', surfaces: ['O'] })],
      history: [history({ toothCode: '16', surfaces: ['O'] })],
      liveServices: [],
    });
    expect(chart.get('16')?.surfaces).toEqual({ O: 'treated' });
  });
});
