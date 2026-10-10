import { describe, expect, it } from 'vitest';
import {
  answerUnfinishedSchema,
  diagnosisResultSchema,
  patientChartSchema,
  planResultSchema,
  planTreatmentSchema,
  recordDiagnosisSchema,
  presenceResultSchema,
  setPresenceInVisitSchema,
  setPresenceOnPatientSchema,
  toothStateSchema,
} from './clinical-records.js';

const ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_2 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';
const ID_3 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70';

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

describe('answerUnfinishedSchema', () => {
  const PLAN = '0198c0de-0000-7000-8000-000000000001';

  it('takes the plans a visit continues, none for "not today", each once', () => {
    expect(answerUnfinishedSchema.safeParse({ continue: [PLAN] }).success).toBe(true);
    expect(answerUnfinishedSchema.safeParse({ continue: [] }).success).toBe(true);
    expect(answerUnfinishedSchema.safeParse({ continue: [PLAN, PLAN] }).success).toBe(false);
    expect(answerUnfinishedSchema.safeParse({}).success).toBe(false);
  });
});

describe('presence inputs (feature 7, H1)', () => {
  it('sets one state in a visit', () => {
    expect(setPresenceInVisitSchema.safeParse({ presence: 'missing' }).success).toBe(true);
    expect(setPresenceInVisitSchema.safeParse({ presence: 'primary' }).success).toBe(false);
  });

  it('sets several teeth on the patient record, each once, with one When', () => {
    const base = {
      teeth: [
        { toothCode: '18', presence: 'missing' },
        { toothCode: '36', presence: 'implant' },
      ],
      when: { kind: 'before_first_visit' },
    };
    expect(setPresenceOnPatientSchema.parse(base)).toEqual({ ...base, reason: null });
    expect(
      setPresenceOnPatientSchema.safeParse({
        ...base,
        when: { kind: 'date', date: '2026-06-03' },
        reason: ' accident ',
        dentistId: ID,
      }).data,
    ).toMatchObject({ when: { kind: 'date', date: '2026-06-03' }, reason: 'accident' });
  });

  it('refuses an empty batch, a tooth twice, a far-future date and a When without its date', () => {
    const tooth = { toothCode: '18', presence: 'missing' };
    const when = { kind: 'before_first_visit' };
    expect(setPresenceOnPatientSchema.safeParse({ teeth: [], when }).success).toBe(false);
    expect(setPresenceOnPatientSchema.safeParse({ teeth: [tooth, tooth], when }).success).toBe(
      false,
    );
    expect(
      setPresenceOnPatientSchema.safeParse({
        teeth: [tooth],
        when: { kind: 'date', date: '2099-01-01' },
      }).success,
    ).toBe(false);
    expect(
      setPresenceOnPatientSchema.safeParse({ teeth: [tooth], when: { kind: 'date' } }).success,
    ).toBe(false);
  });
});

describe('toothStateSchema', () => {
  const base = {
    code: '16',
    presence: 'present',
    state: 'none',
    surfaces: {},
    wholeTooth: null,
    hasActiveDiagnosis: false,
    diagnoses: [],
    services: [],
    openPlanIds: [],
    planInProgress: false,
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
  presence: [
    {
      id: ID,
      toothCode: '36',
      presence: 'missing',
      occurredOn: null,
      reason: 'accident',
      dentistId: ID,
      dentistName: 'Dr. Amal Karim',
      visitId: null,
      visitNumber: null,
      serviceId: null,
      serviceCode: null,
      serviceName: null,
      recordedAt: '2026-09-29T10:00:00Z',
    },
  ],
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
      recordedDate: '2026-09-29',
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
      jaw: null,
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
      groupId: null,
      startedInVisitId: null,
      startedAt: null,
      sessions: [],
      performedInVisitId: null,
      performedAt: null,
      cancelledInVisitId: null,
      cancelledAt: null,
    },
  ],
  planGroups: [],
  history: [
    {
      id: ID,
      visitId: ID_2,
      visitDate: '2026-09-29',
      dentistName: 'Dr. Amal Karim',
      procedureId: ID_3,
      code: 'CMP',
      name: 'Composite filling',
      toothCode: '16',
      jaw: null,
      surfaces: ['O'],
      final: { amount: '45.00', currency: 'USD' },
      planId: null,
    },
  ],
  liveVisitId: ID_2,
  voidedVisitIds: [],
  teeth: [
    {
      code: '16',
      presence: 'present',
      state: 'treated_today',
      surfaces: { O: 'treated_today' },
      wholeTooth: null,
      hasActiveDiagnosis: true,
      diagnoses: [
        {
          recordId: ID,
          diagnosisId: ID_2,
          code: 'DX-CAR',
          name: 'Dental caries',
          color: 'rose',
          priority: 5,
          surfaces: [],
          recordedDate: '2026-09-29',
          dentistName: 'Dr. Amal Karim',
        },
      ],
      services: [
        {
          recordId: ID,
          procedureId: ID_3,
          code: 'CMP',
          name: 'Composite filling',
          color: 'blue',
          icon: 'filling',
          priority: 5,
          surfaces: ['O'],
          status: 'treated_today',
          date: null,
          dentistName: '',
          planId: null,
        },
      ],
      openPlanIds: [ID],
      planInProgress: false,
      historyCount: 1,
      titleParts: { diagnoses: ['Dental caries'], plans: ['Extraction'], historyCount: 1 },
    },
  ],
  marks: {
    [ID_3]: {
      color: 'blue',
      icon: 'filling',
      priority: 5,
      name: 'Composite filling',
      code: 'CMP',
      active: false,
    },
  },
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
    displayNumber: 12,
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
    completedBy: null,
    unfinishedAnsweredAt: null,
    durationMinutes: null,
    notes: '',
    discountMode: 'amount',
    discountValue: '0',
    currency: 'USD',
    services: [],
    money: { subtotal: '0.00', discount: '0.00', total: '0.00', capped: false },
    voidedAt: null,
    voidReason: null,
    updatedAt: '2026-09-29T10:05:00Z',
    serverNow: '2026-09-29T10:10:00Z',
  };
  const [diagnosis] = CHART.diagnoses;
  const [plan] = CHART.plans;

  it('wraps the updated visit with the affected record', () => {
    expect(diagnosisResultSchema.safeParse({ visit, record: diagnosis }).success).toBe(true);
    expect(planResultSchema.safeParse({ visit, record: plan }).success).toBe(true);
    const [presence] = CHART.presence;
    expect(presenceResultSchema.safeParse({ visit, record: presence }).success).toBe(true);
    // Nothing written: the tooth already had that presence.
    expect(presenceResultSchema.safeParse({ visit, record: null }).success).toBe(true);
    expect(
      planResultSchema.safeParse({
        visit,
        record: plan,
        presenceChange: { toothCode: '46', presence: 'implant' },
      }).success,
    ).toBe(true);
  });

  it('rejects a record of the wrong kind', () => {
    expect(diagnosisResultSchema.safeParse({ visit, record: plan }).success).toBe(false);
    expect(planResultSchema.safeParse({ visit, record: diagnosis }).success).toBe(false);
  });
});
