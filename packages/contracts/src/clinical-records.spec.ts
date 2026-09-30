import { describe, expect, it } from 'vitest';
import {
  diagnosisResultSchema,
  patientChartSchema,
  planResultSchema,
  planTreatmentSchema,
  recordDiagnosisSchema,
  setToothPresenceSchema,
  toothPresenceResultSchema,
  toothPresenceSchema,
  toothStateSchema,
} from './clinical-records.js';

const ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_2 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

describe('recordDiagnosisSchema', () => {
  it('accepts a diagnosis on a tooth with surfaces', () => {
    const result = recordDiagnosisSchema.safeParse({
      diagnosisId: ID,
      toothCode: '16',
      surfaces: ['M', 'O'],
    });
    expect(result.success).toBe(true);
  });

  it('defaults surfaces to empty and a blank note to null', () => {
    const result = recordDiagnosisSchema.parse({ diagnosisId: ID, toothCode: '16', note: '  ' });
    expect(result.surfaces).toEqual([]);
    expect(result.note).toBeNull();
  });

  it('rejects an unknown tooth code', () => {
    expect(
      recordDiagnosisSchema.safeParse({ diagnosisId: ID, toothCode: '99', surfaces: [] }).success,
    ).toBe(false);
  });

  it('rejects duplicate surfaces', () => {
    expect(
      recordDiagnosisSchema.safeParse({ diagnosisId: ID, toothCode: '16', surfaces: ['M', 'M'] })
        .success,
    ).toBe(false);
  });
});

describe('planTreatmentSchema', () => {
  it('allows a plan with no tooth (per-jaw services)', () => {
    const result = planTreatmentSchema.safeParse({ procedureId: ID, surfaces: [] });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown tooth code', () => {
    expect(
      planTreatmentSchema.safeParse({ procedureId: ID, toothCode: 'ZZ', surfaces: [] }).success,
    ).toBe(false);
  });
});

describe('setToothPresenceSchema', () => {
  it('accepts primary or permanent', () => {
    expect(setToothPresenceSchema.safeParse({ present: 'primary' }).success).toBe(true);
    expect(setToothPresenceSchema.safeParse({ present: 'permanent' }).success).toBe(true);
  });

  it('rejects anything else', () => {
    expect(setToothPresenceSchema.safeParse({ present: 'missing' }).success).toBe(false);
  });
});

describe('toothPresenceSchema', () => {
  it('accepts a permanent code at position 1–5', () => {
    expect(toothPresenceSchema.safeParse({ position: '14', present: 'primary' }).success).toBe(
      true,
    );
  });

  it('rejects a position beyond 5 (no primary predecessor) and a primary code', () => {
    expect(toothPresenceSchema.safeParse({ position: '16', present: 'primary' }).success).toBe(
      false,
    );
    expect(toothPresenceSchema.safeParse({ position: '54', present: 'primary' }).success).toBe(
      false,
    );
  });
});

describe('toothStateSchema', () => {
  const base = {
    code: '16',
    state: 'none',
    surfaces: {},
    wholeTooth: null,
    hasActiveDiagnosis: false,
    openPlanIds: [],
    historyCount: 0,
    titleParts: { diagnoses: [], plans: [], historyCount: 0 },
  };

  it('accepts a partial surfaces map', () => {
    const result = toothStateSchema.safeParse({
      ...base,
      state: 'treated',
      surfaces: { M: 'treated', O: 'treated_today' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown surface mark', () => {
    const result = toothStateSchema.safeParse({ ...base, surfaces: { M: 'bogus' } });
    expect(result.success).toBe(false);
  });

  it('rejects planned as a surface mark — a plan only ever shows through state', () => {
    const result = toothStateSchema.safeParse({ ...base, surfaces: { M: 'planned' } });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown state', () => {
    expect(toothStateSchema.safeParse({ ...base, state: 'bogus' }).success).toBe(false);
  });

  it('accepts a treated wholeTooth mark but rejects planned', () => {
    expect(toothStateSchema.safeParse({ ...base, wholeTooth: 'treated' }).success).toBe(true);
    expect(toothStateSchema.safeParse({ ...base, wholeTooth: 'treated_today' }).success).toBe(true);
    expect(toothStateSchema.safeParse({ ...base, wholeTooth: 'planned' }).success).toBe(false);
  });
});

const CHART = {
  dentition: { stage: 'permanent', source: 'auto', ageYears: 34 },
  toothStatus: [{ position: '14', present: 'primary' }],
  diagnoses: [
    {
      id: ID,
      patientId: ID,
      toothCode: '16',
      surfaces: ['M', 'O'],
      diagnosisId: ID,
      code: 'DX-CAR',
      name: 'Dental caries',
      category: 'Caries',
      status: 'active',
      note: null,
      dentistId: ID,
      dentistName: 'Dr. Amal Karim',
      recordedBy: ID,
      recordedInVisitId: ID_2,
      recordedInVisitDate: '2026-09-29',
      recordedAt: '2026-09-29T10:00:00Z',
      resolvedInVisitId: null,
      resolvedAt: null,
    },
  ],
  plans: [
    {
      id: ID,
      patientId: ID,
      toothCode: '16',
      surfaces: [],
      procedureId: ID,
      code: 'EXT',
      name: 'Extraction',
      category: 'Surgical',
      chargeUnit: 'per_tooth',
      price: { amount: '30.00', currency: 'USD' },
      diagnosisRecordId: ID,
      status: 'planned',
      note: null,
      dentistId: ID,
      dentistName: 'Dr. Amal Karim',
      recordedBy: ID,
      recordedInVisitId: ID_2,
      recordedAt: '2026-09-29T10:05:00Z',
      performedInVisitId: null,
      performedAt: null,
      cancelledInVisitId: null,
      cancelledAt: null,
    },
  ],
  history: [
    {
      id: ID,
      visitId: ID_2,
      visitDate: '2026-09-29',
      dentistName: 'Dr. Amal Karim',
      code: 'CMP',
      name: 'Composite filling',
      toothCode: '16',
      surfaces: ['O'],
      final: { amount: '45.00', currency: 'USD' },
    },
  ],
  liveVisitId: ID_2,
  teeth: [
    {
      code: '16',
      state: 'treated_today',
      surfaces: { O: 'treated_today' },
      wholeTooth: null,
      hasActiveDiagnosis: true,
      openPlanIds: [ID],
      historyCount: 1,
      titleParts: { diagnoses: ['Dental caries'], plans: ['Extraction'], historyCount: 1 },
    },
  ],
};

describe('patientChartSchema', () => {
  it('round-trips a representative chart', () => {
    const result = patientChartSchema.safeParse(CHART);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(CHART);
  });
});

describe('charting route results', () => {
  const visit = {
    id: ID_2,
    patientId: ID,
    branchId: ID,
    roomId: null,
    dentistId: ID,
    startedBy: ID,
    status: 'in_progress',
    localDate: '2026-09-29',
    startedAt: '2026-09-29T10:00:00Z',
    pausedAt: null,
    pausedSeconds: 0,
    completedAt: null,
    durationMinutes: null,
    notes: '',
    discountMode: 'amount',
    discountValue: '0',
    currency: 'USD',
    services: [],
    money: { subtotal: '0.00', discount: '0.00', total: '0.00', capped: false },
    serverNow: '2026-09-29T10:10:00Z',
  };
  const [diagnosis] = CHART.diagnoses;
  const [plan] = CHART.plans;

  it('wraps the updated visit with the affected record', () => {
    expect(diagnosisResultSchema.safeParse({ visit, record: diagnosis }).success).toBe(true);
    expect(planResultSchema.safeParse({ visit, record: plan }).success).toBe(true);
    expect(
      toothPresenceResultSchema.safeParse({ visit, record: { position: '14', present: 'primary' } })
        .success,
    ).toBe(true);
  });

  it('rejects a record of the wrong kind', () => {
    expect(diagnosisResultSchema.safeParse({ visit, record: plan }).success).toBe(false);
    expect(planResultSchema.safeParse({ visit, record: diagnosis }).success).toBe(false);
  });
});
