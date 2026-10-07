import { describe, expect, it } from 'vitest';
import { subjectOf } from './audit-subject';

const P = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01';
const P2 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d02';
const V = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d03';
const row = (patch: object) => ({ resourceType: 'thing', resourceId: 'x', ...patch });

describe('subjectOf', () => {
  it('takes the resource itself when it is a patient or a visit', () => {
    expect(subjectOf(row({ resourceType: 'patient', resourceId: P }), {})).toEqual({
      patientId: P,
      visitId: null,
    });
    expect(subjectOf(row({ resourceType: 'visit', resourceId: V }), {})).toEqual({
      patientId: null,
      visitId: V,
    });
  });

  it('reads the ids a snapshot carries, the after before the before', () => {
    expect(subjectOf(row({ after: { patientId: P, visitId: V } }), {})).toEqual({
      patientId: P,
      visitId: V,
    });
    expect(subjectOf(row({ before: { patientId: P }, after: { deletedAt: 'now' } }), {})).toEqual({
      patientId: P,
      visitId: null,
    });
    expect(subjectOf(row({ after: { patientId: 'not-an-id', visitId: null } }), {})).toEqual({
      patientId: null,
      visitId: null,
    });
  });

  it('prefers what the caller said, then the surrounding work, over anything derived', () => {
    const ambient = { patientId: P, visitId: V };
    expect(subjectOf(row({ after: { patientId: P2 } }), ambient)).toEqual({
      patientId: P,
      visitId: V,
    });
    expect(subjectOf(row({ patientId: P2 }), ambient)).toEqual({ patientId: P2, visitId: V });
  });
});
