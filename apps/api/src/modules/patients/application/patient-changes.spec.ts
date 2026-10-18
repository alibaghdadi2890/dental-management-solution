import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import type { DomainPatient, DomainPatientListRow } from '../domain/patient';
import { changesOf, mergeSet, normalizeFields } from './patient-changes';
import { toListItem, toPatient } from './patient-mapping';

const DENTIST = '01a0e36d-9ddf-74a5-a703-0cf252c75393';
const PENICILLIN = { id: '01a0e36d-9ddf-74a5-a703-000000000001', name: 'Penicillin' };
const LATEX = { id: '01a0e36d-9ddf-74a5-a703-000000000002', name: 'Latex' };

/** A whole history as an edit sends it. */
const history = (allergyIds: string[], medication: string | null = null) => ({
  noKnownAllergies: false,
  allergyIds,
  noConditions: false,
  conditionIds: [],
  medication,
});

function patient(overrides: Partial<DomainPatient> = {}): DomainPatient {
  return {
    id: '01a0e36d-9db3-7113-8250-342f0c095a91',
    displayNumber: 'P-000001',
    fullName: 'Lina Aoun',
    nameKey: 'lina aoun',
    phone: '+9613123456',
    phoneSearch: '9613123456 03123456',
    dateOfBirth: '1990-01-02',
    sex: 'female',
    email: null,
    address: null,
    insurance: null,
    notes: null,
    noKnownAllergies: false,
    allergies: [PENICILLIN],
    noConditions: false,
    conditions: [],
    medication: null,
    firstVisitType: null,
    primaryDentistId: DENTIST,
    dentitionOverride: null,
    externalId: null,
    mergedIntoId: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

const TODAY = '2026-01-01';
/** 18 on `TODAY`: an adult. */
const ADULT_DOB = '2007-12-31';

const issues = (fn: () => unknown): { path: string; code: string }[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationFailedError) {
      return error.issues.map(({ path, code }) => ({ path, code }));
    }
    throw error;
  }
  return [];
};

const issuePaths = (fn: () => unknown): string[] => issues(fn).map((issue) => issue.path);

describe('normalizeFields', () => {
  it('stores a valid phone as E.164, searchable by its E.164 and national digits', () => {
    expect(normalizeFields({ phone: '03 123 456' }, 'LB', TODAY)).toEqual({
      phone: { value: '+9613123456', search: '9613123456 03123456' },
    });
  });

  it('accepts an international number as typed', () => {
    expect(normalizeFields({ phone: '+33 6 12 34 56 78' }, 'LB', TODAY)).toEqual({
      phone: { value: '+33612345678', search: '33612345678 0612345678' },
    });
  });

  it('keeps a number the library cannot place as typed (ADR-0052)', () => {
    expect(normalizeFields({ phone: '70 122 9951' }, 'LB', TODAY)).toEqual({
      phone: { value: '70 122 9951', search: '701229951' },
    });
  });

  it('lets any patient be without a phone, an adult or one with no date of birth included', () => {
    expect(normalizeFields({ phone: null, dateOfBirth: ADULT_DOB }, 'LB', TODAY)).toEqual({
      phone: null,
    });
    expect(normalizeFields({ phone: null, dateOfBirth: null }, 'LB', TODAY)).toEqual({
      phone: null,
    });
  });

  it('leaves absent fields out of an edit', () => {
    expect(normalizeFields({}, 'LB', TODAY)).toEqual({});
  });

  it("allows a date of birth up to the tenant's today, and refuses a later one", () => {
    expect(issuePaths(() => normalizeFields({ dateOfBirth: TODAY }, 'LB', TODAY))).toEqual([]);
    expect(issuePaths(() => normalizeFields({ dateOfBirth: null }, 'LB', TODAY))).toEqual([]);
    expect(issues(() => normalizeFields({ dateOfBirth: '2026-01-02' }, 'LB', TODAY))).toEqual([
      { path: 'dateOfBirth', code: 'future_date' },
    ]);
  });
});

describe('changesOf', () => {
  it('sees no change for the same phone in another format and the same dentist', () => {
    const patch = { phone: '03-123-456', primaryDentistId: DENTIST, fullName: 'Lina Aoun' };
    const normalized = normalizeFields(patch, 'LB', TODAY);
    expect(changesOf(patient(), patch, normalized)).toEqual({ set: {}, fields: [] });
  });

  it('sees no change for the same medical history, and one for another item or line', () => {
    const same = { medicalHistory: history([PENICILLIN.id]) };
    expect(changesOf(patient(), same, {}).fields).toEqual([]);
    const more = { medicalHistory: history([LATEX.id, PENICILLIN.id]) };
    expect(changesOf(patient(), more, {})).toEqual({ set: more, fields: ['medicalHistory'] });
    expect(
      changesOf(patient(), { medicalHistory: history([PENICILLIN.id], 'Warfarin') }, {}).fields,
    ).toEqual(['medicalHistory']);
  });

  it('lists only the changed fields, with the stored values', () => {
    const patch = { phone: '71 123 456', address: '12 Hamra St', notes: null };
    const result = changesOf(patient(), patch, normalizeFields(patch, 'LB', TODAY));
    expect(result.fields).toEqual(['phone', 'address']);
    expect(result.set).toEqual({
      phone: { value: '+96171123456', search: '96171123456 71123456' },
      address: '12 Hamra St',
    });
  });

  it('clears a field set to null, the phone included', () => {
    const result = changesOf(patient(), { dateOfBirth: null, primaryDentistId: null }, {});
    expect(result).toEqual({
      set: { dateOfBirth: null, primaryDentistId: null },
      fields: ['dateOfBirth', 'primaryDentistId'],
    });
    expect(changesOf(patient(), { phone: null }, { phone: null })).toEqual({
      set: { phone: null },
      fields: ['phone'],
    });
    const phoneless = patient({ phone: null, phoneSearch: null });
    expect(changesOf(phoneless, { phone: null }, { phone: null }).fields).toEqual([]);
  });
});

describe('mergeSet', () => {
  it('re-derives the search digits of a picked E.164 phone, whatever the country', () => {
    expect(mergeSet(patient(), { phone: '+33612345678', address: 'Rue X' }, 'LB')).toEqual({
      phone: { value: '+33612345678', search: '33612345678 0612345678' },
      address: 'Rue X',
    });
  });

  it('keeps a picked phone stored as typed as it is', () => {
    expect(mergeSet(patient(), { phone: '70 122 9951' }, 'LB')).toEqual({
      phone: { value: '70 122 9951', search: '701229951' },
    });
  });

  it('passes a patch without a phone through, and a null phone as a clear', () => {
    expect(mergeSet(patient(), { address: 'Rue X' }, 'LB')).toEqual({ address: 'Rue X' });
    expect(mergeSet(patient(), { phone: null }, 'LB')).toEqual({ phone: null });
  });

  it('stores the history whole: the unioned items with the picked medication line', () => {
    const medicalItems = {
      noKnownAllergies: false,
      allergyIds: [PENICILLIN.id, LATEX.id],
      noConditions: true,
      conditionIds: [],
    };
    expect(mergeSet(patient({ medication: 'Aspirin' }), { medicalItems }, 'LB')).toEqual({
      medicalHistory: { ...medicalItems, medication: 'Aspirin' },
    });
    // Only the medication line was picked: the kept record's items stay.
    expect(mergeSet(patient(), { medication: 'Warfarin' }, 'LB')).toEqual({
      medicalHistory: history([PENICILLIN.id], 'Warfarin'),
    });
  });
});

describe('mapping', () => {
  it('maps a record to the contract with ISO timestamps and archivedAt from deletedAt', () => {
    const archived = patient({ deletedAt: new Date('2026-02-01T10:00:00Z') });
    const record = toPatient(archived);
    expect(record).toMatchObject({
      archivedAt: '2026-02-01T10:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(record).not.toHaveProperty('nameKey');
    expect(record).not.toHaveProperty('phoneSearch');
    expect(toListItem(listRow(archived))).toMatchObject({ archivedAt: '2026-02-01T10:00:00.000Z' });
    expect(toListItem(listRow(patient())).archivedAt).toBeNull();
  });

  it('carries the dentist profile id and a null phone, and no guardian fields', () => {
    const record = toPatient(patient({ phone: null, phoneSearch: null }));
    expect(record).toMatchObject({ phone: null, primaryDentistId: DENTIST });
    expect(record).not.toHaveProperty('guardianName');
    expect(record).not.toHaveProperty('emergencyContact');
    expect(toListItem(listRow(patient()))).toMatchObject({ primaryDentistId: DENTIST });
  });

  it('carries the primary guardian and the matched contact of a list row', () => {
    const primaryGuardian = {
      contactId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5e99',
      fullName: 'Mona Haddad',
      phone: '+9613123456',
      relationship: 'parent' as const,
    };
    const matchedContact = { fullName: 'Mona Haddad', relationship: 'parent' as const };
    expect(toListItem({ ...patient(), primaryGuardian, matchedContact })).toMatchObject({
      primaryGuardian,
      matchedContact,
    });
    expect(toListItem(listRow(patient()))).toMatchObject({
      primaryGuardian: null,
      matchedContact: null,
    });
  });
});

function listRow(value: DomainPatient): DomainPatientListRow {
  return { ...value, primaryGuardian: null, matchedContact: null };
}
