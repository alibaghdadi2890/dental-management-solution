import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import type { DomainPatient } from '../domain/patient';
import { changesOf, mergeSet, normalizeFields } from './patient-changes';
import { toListItem, toPatient } from './patient-mapping';

const DENTIST = '01a0e36d-9ddf-74a5-a703-0cf252c75393';

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
    emergencyContact: null,
    notes: null,
    medicalAlerts: ['Penicillin'],
    primaryDentistUserId: DENTIST,
    guardianName: null,
    guardianPhone: null,
    externalId: null,
    mergedIntoId: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

const issuePaths = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationFailedError) return error.issues.map((issue) => issue.path);
    throw error;
  }
  return [];
};

describe('normalizeFields', () => {
  it('normalises phones against the tenant country to E.164', () => {
    expect(
      normalizeFields({ phone: '03 123 456', guardianPhone: '71 123 456' }, 'LB', '2026-01-01'),
    ).toEqual({
      phone: { e164: '+9613123456', national: '03123456' },
      guardianPhone: '+96171123456',
    });
  });

  it('accepts an international number as typed, and null clears the guardian phone', () => {
    expect(
      normalizeFields({ phone: '+33 6 12 34 56 78', guardianPhone: null }, 'LB', '2026-01-01'),
    ).toEqual({
      phone: { e164: '+33612345678', national: '0612345678' },
      guardianPhone: null,
    });
  });

  it('leaves absent fields out', () => {
    expect(normalizeFields({}, 'LB', '2026-01-01')).toEqual({});
  });

  it('reports every invalid field at once, by path', () => {
    expect(
      issuePaths(() =>
        normalizeFields(
          { phone: '12', guardianPhone: '999', dateOfBirth: '2026-01-02' },
          'LB',
          '2026-01-01',
        ),
      ),
    ).toEqual(['phone', 'guardianPhone', 'dateOfBirth']);
  });

  it("allows a date of birth up to the tenant's today", () => {
    expect(
      issuePaths(() => normalizeFields({ dateOfBirth: '2026-01-01' }, 'LB', '2026-01-01')),
    ).toEqual([]);
    expect(issuePaths(() => normalizeFields({ dateOfBirth: null }, 'LB', '2026-01-01'))).toEqual(
      [],
    );
  });
});

describe('changesOf', () => {
  it('sees no change for the same phone in another format and the same dentist', () => {
    const patch = { phone: '03-123-456', primaryDentistUserId: DENTIST, fullName: 'Lina Aoun' };
    const normalized = normalizeFields(patch, 'LB', '2026-01-01');
    expect(changesOf(patient(), patch, normalized)).toEqual({ set: {}, fields: [] });
  });

  it('sees no change for the same alerts, and a change when their order differs', () => {
    expect(changesOf(patient(), { medicalAlerts: ['Penicillin'] }, {}).fields).toEqual([]);
    expect(changesOf(patient(), { medicalAlerts: ['Latex', 'Penicillin'] }, {}).fields).toEqual([
      'medicalAlerts',
    ]);
  });

  it('lists only the changed fields, with the normalised values', () => {
    const patch = {
      phone: '71 123 456',
      address: '12 Hamra St',
      notes: null,
      guardianPhone: '76 654 321',
    };
    const result = changesOf(patient(), patch, normalizeFields(patch, 'LB', '2026-01-01'));
    expect(result.fields).toEqual(['phone', 'address', 'guardianPhone']);
    expect(result.set).toEqual({
      phone: { e164: '+96171123456', national: '71123456' },
      address: '12 Hamra St',
      guardianPhone: '+96176654321',
    });
  });

  it('clears a field set to null', () => {
    const result = changesOf(patient(), { dateOfBirth: null, primaryDentistUserId: null }, {});
    expect(result).toEqual({
      set: { dateOfBirth: null, primaryDentistUserId: null },
      fields: ['dateOfBirth', 'primaryDentistUserId'],
    });
  });
});

describe('mergeSet', () => {
  it('re-derives the national digits of a picked E.164 phone, whatever the country', () => {
    expect(mergeSet({ phone: '+33612345678', address: 'Rue X' }, 'LB')).toEqual({
      phone: { e164: '+33612345678', national: '0612345678' },
      address: 'Rue X',
    });
  });

  it('passes a patch without a phone through', () => {
    expect(mergeSet({ medicalAlerts: ['Latex'] }, 'LB')).toEqual({ medicalAlerts: ['Latex'] });
  });

  it('refuses a stored phone that is not valid E.164', () => {
    expect(() => mergeSet({ phone: 'not a phone' }, 'LB')).toThrow('not a valid E.164');
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
    expect(toListItem(archived)).toMatchObject({ archivedAt: '2026-02-01T10:00:00.000Z' });
    expect(toListItem(patient()).archivedAt).toBeNull();
  });
});
