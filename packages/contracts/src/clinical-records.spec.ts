import { describe, expect, it } from 'vitest';
import {
  planTreatmentSchema,
  recordDiagnosisSchema,
  setToothPresenceSchema,
  toothStateSchema,
} from './clinical-records.js';

const ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';

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
      surfaces: { M: 'treated', O: 'planned' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown surface mark', () => {
    const result = toothStateSchema.safeParse({ ...base, surfaces: { M: 'bogus' } });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown state', () => {
    expect(toothStateSchema.safeParse({ ...base, state: 'bogus' }).success).toBe(false);
  });
});
