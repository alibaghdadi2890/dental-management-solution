import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import type { DomainPatient } from '../domain/patient';
import { assertMergePhoneRule, changesOf, mergeSet, normalizeFields } from './patient-changes';
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
    notes: null,
    medicalAlerts: ['Penicillin'],
    primaryDentistId: DENTIST,
    externalId: null,
    mergedIntoId: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

const TODAY = '2026-01-01';
/** 17 on `TODAY`: a minor. */
const MINOR_DOB = '2008-06-01';
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

const PHONE_REQUIRED = [{ path: 'phone', code: 'required' }];

describe('normalizeFields', () => {
  it('normalises the phone against the tenant country to E.164', () => {
    expect(normalizeFields({ phone: '03 123 456' }, 'LB', TODAY, null)).toEqual({
      phone: { e164: '+9613123456', national: '03123456' },
    });
  });

  it('accepts an international number as typed', () => {
    expect(normalizeFields({ phone: '+33 6 12 34 56 78' }, 'LB', TODAY, null)).toEqual({
      phone: { e164: '+33612345678', national: '0612345678' },
    });
  });

  it('leaves absent fields out of an edit', () => {
    expect(normalizeFields({}, 'LB', TODAY, patient())).toEqual({});
  });

  it('reports every invalid field at once, by path', () => {
    expect(
      issuePaths(() =>
        normalizeFields({ phone: '12', dateOfBirth: '2026-01-02' }, 'LB', TODAY, null),
      ),
    ).toEqual(['phone', 'dateOfBirth']);
  });

  it("allows a date of birth up to the tenant's today", () => {
    expect(
      issuePaths(() => normalizeFields({ dateOfBirth: TODAY }, 'LB', TODAY, patient())),
    ).toEqual([]);
    expect(
      issuePaths(() => normalizeFields({ dateOfBirth: null }, 'LB', TODAY, patient())),
    ).toEqual([]);
  });

  describe('the phone rule (addendum C3)', () => {
    it('requires a phone on create for an adult, and for a patient without a date of birth', () => {
      expect(
        issues(() => normalizeFields({ phone: null, dateOfBirth: ADULT_DOB }, 'LB', TODAY, null)),
      ).toEqual(PHONE_REQUIRED);
      expect(
        issues(() => normalizeFields({ phone: null, dateOfBirth: null }, 'LB', TODAY, null)),
      ).toEqual(PHONE_REQUIRED);
    });

    it("lets a minor (on the tenant's today) be created without a phone", () => {
      expect(normalizeFields({ phone: null, dateOfBirth: MINOR_DOB }, 'LB', TODAY, null)).toEqual({
        phone: null,
      });
    });

    it("rejects clearing an adult's phone, and allows clearing a minor's", () => {
      expect(issues(() => normalizeFields({ phone: null }, 'LB', TODAY, patient()))).toEqual(
        PHONE_REQUIRED,
      );
      const minor = patient({ dateOfBirth: MINOR_DOB });
      expect(normalizeFields({ phone: null }, 'LB', TODAY, minor)).toEqual({ phone: null });
    });

    it('rejects an adult date of birth (or none) for a phoneless minor', () => {
      const phoneless = patient({ dateOfBirth: MINOR_DOB, phone: null, phoneSearch: null });
      expect(
        issues(() => normalizeFields({ dateOfBirth: ADULT_DOB }, 'LB', TODAY, phoneless)),
      ).toEqual(PHONE_REQUIRED);
      expect(issues(() => normalizeFields({ dateOfBirth: null }, 'LB', TODAY, phoneless))).toEqual(
        PHONE_REQUIRED,
      );
      expect(
        normalizeFields({ dateOfBirth: ADULT_DOB, phone: '03 123 456' }, 'LB', TODAY, phoneless),
      ).toMatchObject({ phone: { e164: '+9613123456' } });
    });

    it('leaves an edit that touches neither the phone nor the date of birth alone', () => {
      // A minor recorded without a phone who has since come of age.
      const agedOut = patient({ dateOfBirth: ADULT_DOB, phone: null, phoneSearch: null });
      expect(normalizeFields({}, 'LB', TODAY, agedOut)).toEqual({});
    });

    it('reports an invalid phone, not a missing one', () => {
      expect(issues(() => normalizeFields({ phone: '12' }, 'LB', TODAY, null))).toEqual([
        { path: 'phone', code: 'invalid_phone' },
      ]);
    });
  });
});

describe('assertMergePhoneRule', () => {
  it('refuses a merge that leaves an adult without a phone', () => {
    expect(
      issues(() => {
        assertMergePhoneRule(patient(), { phone: null }, TODAY);
      }),
    ).toEqual(PHONE_REQUIRED);
  });

  it("allows a minor's merge without a phone, and a merge that changes neither field", () => {
    const minor = patient({ dateOfBirth: MINOR_DOB });
    expect(
      issues(() => {
        assertMergePhoneRule(minor, { phone: null }, TODAY);
      }),
    ).toEqual([]);
    const agedOut = patient({ phone: null, phoneSearch: null });
    expect(
      issues(() => {
        assertMergePhoneRule(agedOut, { notes: 'x' }, TODAY);
      }),
    ).toEqual([]);
  });
});

describe('changesOf', () => {
  it('sees no change for the same phone in another format and the same dentist', () => {
    const patch = { phone: '03-123-456', primaryDentistId: DENTIST, fullName: 'Lina Aoun' };
    const normalized = normalizeFields(patch, 'LB', TODAY, patient());
    expect(changesOf(patient(), patch, normalized)).toEqual({ set: {}, fields: [] });
  });

  it('sees no change for the same alerts, and a change when their order differs', () => {
    expect(changesOf(patient(), { medicalAlerts: ['Penicillin'] }, {}).fields).toEqual([]);
    expect(changesOf(patient(), { medicalAlerts: ['Latex', 'Penicillin'] }, {}).fields).toEqual([
      'medicalAlerts',
    ]);
  });

  it('lists only the changed fields, with the normalised values', () => {
    const patch = { phone: '71 123 456', address: '12 Hamra St', notes: null };
    const result = changesOf(patient(), patch, normalizeFields(patch, 'LB', TODAY, patient()));
    expect(result.fields).toEqual(['phone', 'address']);
    expect(result.set).toEqual({
      phone: { e164: '+96171123456', national: '71123456' },
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
  it('re-derives the national digits of a picked E.164 phone, whatever the country', () => {
    expect(mergeSet({ phone: '+33612345678', address: 'Rue X' }, 'LB')).toEqual({
      phone: { e164: '+33612345678', national: '0612345678' },
      address: 'Rue X',
    });
  });

  it('passes a patch without a phone through, and a null phone as a clear', () => {
    expect(mergeSet({ medicalAlerts: ['Latex'] }, 'LB')).toEqual({ medicalAlerts: ['Latex'] });
    expect(mergeSet({ phone: null }, 'LB')).toEqual({ phone: null });
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

  it('carries the dentist profile id and a null phone, and no guardian fields', () => {
    const record = toPatient(patient({ phone: null, phoneSearch: null }));
    expect(record).toMatchObject({ phone: null, primaryDentistId: DENTIST });
    expect(record).not.toHaveProperty('guardianName');
    expect(record).not.toHaveProperty('emergencyContact');
    expect(toListItem(patient())).toMatchObject({ primaryDentistId: DENTIST });
  });
});
