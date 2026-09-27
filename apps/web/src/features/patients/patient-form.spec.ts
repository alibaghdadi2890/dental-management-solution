import type { Patient } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  emptyForm,
  fromPatient,
  isDirty,
  parseAlerts,
  sanitizeAmount,
  showGuardian,
  toCreatePayload,
  toOpeningBalance,
  toPatchPayload,
  validate,
  wantsOpeningBalance,
  type PatientFormValues,
} from './patient-form';

const TODAY = '2026-09-27';
const CTX = { country: 'LB', today: TODAY };

const PATIENT: Patient = {
  id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
  displayNumber: 'P-000001',
  fullName: 'Jane Doe',
  phone: '+9613123456',
  dateOfBirth: '1990-01-01',
  sex: 'female',
  email: 'jane@example.com',
  address: '1 Main St',
  insurance: null,
  emergencyContact: null,
  medicalAlerts: ['Penicillin'],
  primaryDentistUserId: null,
  notes: null,
  guardianName: null,
  guardianPhone: null,
  externalId: null,
  archivedAt: null,
  mergedIntoId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('emptyForm / fromPatient', () => {
  it('pre-fills only fullName/phone for a blank create form', () => {
    expect(emptyForm({ phone: '03123456' }).fullName).toBe('');
    expect(emptyForm({ phone: '03123456' }).phone).toBe('03123456');
    expect(emptyForm().sex).toBe('unknown');
  });

  it('reads an existing patient into form values, alerts joined and dentist blank when unset', () => {
    const values = fromPatient(PATIENT);
    expect(values.fullName).toBe('Jane Doe');
    expect(values.alertsText).toBe('Penicillin');
    expect(values.primaryDentistUserId).toBe('');
    expect(values.dateOfBirth).toBe('1990-01-01');
  });

  it('never carries an opening balance into the edit form (create-only, Q1/Q12)', () => {
    expect(fromPatient(PATIENT).openingBalanceAmount).toBe('');
  });
});

describe('validate', () => {
  const base = emptyForm();

  it('requires a full name and a phone', () => {
    const errors = validate(base, CTX);
    expect(errors.fullName).toBe('required');
    expect(errors.phone).toBe('required');
  });

  it('rejects a phone that is not valid for the tenant country', () => {
    const errors = validate({ ...base, fullName: 'Jane', phone: '12' }, CTX);
    expect(errors.phone).toBe('invalidPhone');
  });

  it('accepts a valid LB local number', () => {
    const errors = validate({ ...base, fullName: 'Jane', phone: '03 123 456' }, CTX);
    expect(errors.phone).toBeUndefined();
  });

  it('flags an invalid email format', () => {
    const errors = validate(
      { ...base, fullName: 'Jane', phone: '03123456', email: 'not-an-email' },
      CTX,
    );
    expect(errors.email).toBe('invalidEmail');
  });

  it('flags a date of birth in the future relative to the tenant today', () => {
    const errors = validate(
      { ...base, fullName: 'Jane', phone: '03123456', dateOfBirth: '2026-09-28' },
      CTX,
    );
    expect(errors.dateOfBirth).toBe('futureDate');
  });

  it('flags a date of birth before the plausible floor', () => {
    const errors = validate(
      { ...base, fullName: 'Jane', phone: '03123456', dateOfBirth: '1899-12-31' },
      CTX,
    );
    expect(errors.dateOfBirth).toBe('beforeMinDate');
  });

  it('flags free text over its max length', () => {
    const errors = validate(
      { ...base, fullName: 'Jane', phone: '03123456', notes: 'x'.repeat(2001) },
      CTX,
    );
    expect(errors.notes).toBe('tooLong');
  });
});

describe('showGuardian', () => {
  it('is false at exactly 18', () => {
    expect(showGuardian({ ...emptyForm(), dateOfBirth: '2008-09-27' }, TODAY)).toBe(false);
  });

  it('is true at 17', () => {
    expect(showGuardian({ ...emptyForm(), dateOfBirth: '2009-09-27' }, TODAY)).toBe(true);
  });

  it('is false with no date of birth set', () => {
    expect(showGuardian(emptyForm(), TODAY)).toBe(false);
  });
});

describe('toCreatePayload', () => {
  it('sends a hidden guardian as null even when the fields still hold text', () => {
    const values: PatientFormValues = {
      ...emptyForm(),
      fullName: 'Jane',
      phone: '03123456',
      dateOfBirth: '2009-09-27', // 17 — guardian shown
      guardianName: 'Guardian Doe',
      guardianPhone: '03654321',
    };
    // The date of birth is then edited back to an adult date before submitting.
    const adult = { ...values, dateOfBirth: '1990-01-01' };
    const payload = toCreatePayload(adult, TODAY);
    expect(payload.guardianName).toBeNull();
    expect(payload.guardianPhone).toBeNull();
  });

  it('keeps the guardian while the patient is still a minor', () => {
    const values: PatientFormValues = {
      ...emptyForm(),
      fullName: 'Jane',
      phone: '03123456',
      dateOfBirth: '2009-09-27',
      guardianName: 'Guardian Doe',
      guardianPhone: '03654321',
    };
    const payload = toCreatePayload(values, TODAY);
    expect(payload.guardianName).toBe('Guardian Doe');
  });
});

describe('isDirty', () => {
  it('is false for identical values and true after one field changes', () => {
    const initial = emptyForm({ fullName: 'Jane' });
    expect(isDirty(initial, { ...initial })).toBe(false);
    expect(isDirty(initial, { ...initial, phone: '03123456' })).toBe(true);
  });
});

describe('parseAlerts', () => {
  it('trims, drops blanks, and de-dupes case-insensitively', () => {
    expect(parseAlerts('Penicillin, penicillin , , Latex')).toEqual(['Penicillin', 'Latex']);
  });

  it('caps at MEDICAL_ALERTS_MAX', () => {
    const many = Array.from({ length: 25 }, (_, i) => `Alert ${i}`).join(',');
    expect(parseAlerts(many)).toHaveLength(20);
  });
});

describe('toPatchPayload', () => {
  const initial = fromPatient(PATIENT);

  it('is {} when nothing changed', () => {
    expect(toPatchPayload(initial, { ...initial }, TODAY)).toEqual({});
  });

  it('sends only the fields that changed', () => {
    const current = { ...initial, address: '2 Second St' };
    expect(toPatchPayload(initial, current, TODAY)).toEqual({ address: '2 Second St' });
  });

  it('clears the guardian in the patch once it is hidden again', () => {
    const withGuardian = {
      ...fromPatient({ ...PATIENT, dateOfBirth: '2009-09-27' }),
      guardianName: 'Guardian Doe',
      guardianPhone: '03654321',
    };
    const madeAdult = { ...withGuardian, dateOfBirth: '1990-01-01' };
    expect(toPatchPayload(withGuardian, madeAdult, TODAY)).toEqual({
      dateOfBirth: '1990-01-01',
      guardianName: null,
      guardianPhone: null,
    });
  });
});

describe('sanitizeAmount', () => {
  it('strips thousands separators and caps at two decimals', () => {
    expect(sanitizeAmount('1,234.567')).toBe('1234.56');
  });

  it('drops non-numeric input entirely', () => {
    expect(sanitizeAmount('abc')).toBe('');
  });

  it('leaves a leading-dot amount as typed', () => {
    expect(sanitizeAmount('.5')).toBe('.5');
  });
});

describe('wantsOpeningBalance / toOpeningBalance', () => {
  it('wants a balance only when the amount is greater than zero', () => {
    expect(wantsOpeningBalance({ ...emptyForm(), openingBalanceAmount: '' })).toBe(false);
    expect(wantsOpeningBalance({ ...emptyForm(), openingBalanceAmount: '0' })).toBe(false);
    expect(wantsOpeningBalance({ ...emptyForm(), openingBalanceAmount: '50' })).toBe(true);
  });

  it('defaults asOf to today when left blank', () => {
    const balance = toOpeningBalance({ ...emptyForm(), openingBalanceAmount: '50' }, TODAY);
    expect(balance).toEqual({ amount: '50', asOf: TODAY, note: null });
  });
});
