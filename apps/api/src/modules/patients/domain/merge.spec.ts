import { describe, expect, it } from 'vitest';
import type { DomainPatient } from './patient';
import { resolveMerge } from './merge';

const PENICILLIN = { id: 'penicillin', name: 'Penicillin' };
const LATEX = { id: 'latex', name: 'Latex' };

function patient(overrides: Partial<DomainPatient> = {}): DomainPatient {
  return {
    id: 'kept-id',
    displayNumber: 'P-000001',
    fullName: 'Kept Name',
    nameKey: 'kept name',
    phone: '+96100000001',
    phoneSearch: '96100000001 00000001',
    dateOfBirth: '2000-01-01',
    sex: 'female',
    email: 'kept@example.com',
    address: 'Kept Addr',
    insurance: 'Kept Ins',
    notes: 'Kept notes',
    noKnownAllergies: false,
    allergies: [PENICILLIN],
    noConditions: false,
    conditions: [],
    medication: null,
    firstVisitType: null,
    primaryDentistId: 'dentist-1',
    dentitionOverride: null,
    externalId: null,
    mergedIntoId: null,
    deletedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  };
}

const dropped = patient({
  id: 'dropped-id',
  displayNumber: 'P-000002',
  fullName: 'Dropped Name',
  nameKey: 'dropped name',
  phone: '+96100000002',
  phoneSearch: '96100000002 00000002',
  dateOfBirth: '1999-05-05',
  sex: 'male',
  email: 'dropped@example.com',
  address: 'Dropped Addr',
  insurance: 'Dropped Ins',
  notes: 'Dropped notes',
  allergies: [PENICILLIN, LATEX],
  medication: 'Warfarin',
  primaryDentistId: 'dentist-2',
});

describe('resolveMerge', () => {
  const UNION = {
    noKnownAllergies: false,
    allergyIds: ['penicillin', 'latex'],
    noConditions: false,
    conditionIds: [],
  };

  it('keeps every field by default, still unioning the allergies and conditions', () => {
    const kept = patient();
    const patch = resolveMerge(kept, dropped, {});
    expect(patch).toEqual({ medicalItems: UNION });
  });

  it('picks the medication line like any other field', () => {
    expect(resolveMerge(patient(), dropped, { medication: 'drop' })).toMatchObject({
      medication: 'Warfarin',
    });
    expect(resolveMerge(patient(), dropped, {}).medication).toBeUndefined();
  });

  it('takes a field from the dropped record when chosen', () => {
    const kept = patient();
    const patch = resolveMerge(kept, dropped, { fullName: 'drop' });
    expect(patch).toEqual({ fullName: 'Dropped Name', medicalItems: UNION });
  });

  it('resolves every scalar field independently', () => {
    const kept = patient();
    const patch = resolveMerge(kept, dropped, {
      phone: 'drop',
      dateOfBirth: 'drop',
      sex: 'drop',
      email: 'drop',
      address: 'drop',
      insurance: 'drop',
      primaryDentistId: 'drop',
      notes: 'drop',
    });
    expect(patch).toMatchObject({
      phone: '+96100000002',
      dateOfBirth: '1999-05-05',
      sex: 'male',
      email: 'dropped@example.com',
      address: 'Dropped Addr',
      insurance: 'Dropped Ins',
      primaryDentistId: 'dentist-2',
      notes: 'Dropped notes',
    });
    expect(patch.fullName).toBeUndefined();
  });

  it("takes the dropped record's missing phone (a minor recorded without one) when chosen", () => {
    const kept = patient();
    const phoneless = patient({ id: 'dropped-id', phone: null, phoneSearch: null });
    expect(resolveMerge(kept, phoneless, { phone: 'drop' })).toMatchObject({ phone: null });
    expect(resolveMerge(phoneless, kept, { phone: 'drop' })).toMatchObject({
      phone: '+96100000001',
    });
  });

  it('leaves out the fields where both sides already agree', () => {
    const kept = patient();
    const same = patient({ id: 'dropped-id', displayNumber: 'P-000002' });
    expect(resolveMerge(kept, same, { phone: 'drop', primaryDentistId: 'drop' })).toEqual({});
  });

  it('omits the medical items from the patch when the kept record already has them all', () => {
    const kept = patient({ allergies: [PENICILLIN, LATEX] });
    const patch = resolveMerge(kept, patient({ id: 'dropped-id', allergies: [LATEX] }), {});
    expect(patch.medicalItems).toBeUndefined();
  });
});
