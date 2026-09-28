import type { Patient, PatientSex } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  amountValue,
  emptyForm,
  fromPatient,
  isDirty,
  isEditDirty,
  parseAlerts,
  phoneOptional,
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
  medicalAlerts: ['Penicillin'],
  primaryDentistId: null,
  notes: null,
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

  it('reads an existing patient into form values, alerts joined, phone shown in national format', () => {
    const values = fromPatient(PATIENT, 'LB');
    expect(values.fullName).toBe('Jane Doe');
    expect(values.alertsText).toBe('Penicillin');
    expect(values.primaryDentistId).toBe('');
    expect(values.dateOfBirth).toBe('1990-01-01');
    expect(values.phone).toBe('03 123 456');
  });

  it("reads the dentist's staff profile id, and a missing phone as blank", () => {
    const values = fromPatient(
      { ...PATIENT, phone: null, primaryDentistId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5e80' },
      'LB',
    );
    expect(values.phone).toBe('');
    expect(values.primaryDentistId).toBe('01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5e80');
  });

  it('never carries an opening balance into the edit form (create-only, Q1/Q12)', () => {
    expect(fromPatient(PATIENT, 'LB').openingBalanceAmount).toBe('');
  });
});

describe('validate', () => {
  const base = emptyForm();

  it('requires a full name and a phone', () => {
    const errors = validate(base, CTX);
    expect(errors.fullName).toBe('required');
    expect(errors.phone).toBe('required');
  });

  it("makes the phone optional for a minor on the tenant's today, not for an adult", () => {
    const named = { ...base, fullName: 'Jane' };
    // 16 on TODAY: a minor.
    expect(validate({ ...named, dateOfBirth: '2009-09-28' }, CTX).phone).toBeUndefined();
    // Exactly 18 on TODAY: an adult.
    expect(validate({ ...named, dateOfBirth: '2008-09-27' }, CTX).phone).toBe('required');
    // No date of birth means an adult.
    expect(validate(named, CTX).phone).toBe('required');
    // A minor's phone, when typed, is still checked.
    expect(validate({ ...named, dateOfBirth: '2009-09-28', phone: '12' }, CTX).phone).toBe(
      'invalidPhone',
    );
  });

  it('flags a full name over the contract limit (120 chars)', () => {
    const errors = validate({ ...base, fullName: 'x'.repeat(121), phone: '03123456' }, CTX);
    expect(errors.fullName).toBe('tooLong');
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

  it('flags an impossible calendar date', () => {
    const errors = validate(
      { ...base, fullName: 'Jane', phone: '03123456', dateOfBirth: '2026-13-45' },
      CTX,
    );
    expect(errors.dateOfBirth).toBe('invalidDate');
  });

  it('flags free text over its max length', () => {
    const errors = validate(
      { ...base, fullName: 'Jane', phone: '03123456', notes: 'x'.repeat(2001) },
      CTX,
    );
    expect(errors.notes).toBe('tooLong');
  });

  it('checks the length on the trimmed value, not the raw one', () => {
    const errors = validate(
      { ...base, fullName: 'Jane', phone: '03123456', notes: `  ${'x'.repeat(2000)}  ` },
      CTX,
    );
    expect(errors.notes).toBeUndefined();
  });

  it('flags a single alert over 60 characters', () => {
    const errors = validate(
      { ...base, fullName: 'Jane', phone: '03123456', alertsText: 'x'.repeat(61) },
      CTX,
    );
    expect(errors.alerts).toBe('tooLong');
  });

  it('flags more than MEDICAL_ALERTS_MAX distinct alerts after de-duping', () => {
    const alertsText = Array.from({ length: 25 }, (_, i) => `Alert ${i}`).join(',');
    const errors = validate({ ...base, fullName: 'Jane', phone: '03123456', alertsText }, CTX);
    expect(errors.alerts).toBe('tooMany');
  });

  it('requires a properly formatted, zero or positive opening balance amount when one is entered', () => {
    expect(
      validate({ ...base, fullName: 'Jane', phone: '03123456', openingBalanceAmount: 'abc' }, CTX)
        .openingBalanceAmount,
    ).toBe('invalidAmount');
    for (const zero of ['0', '0.00']) {
      expect(
        validate({ ...base, fullName: 'Jane', phone: '03123456', openingBalanceAmount: zero }, CTX)
          .openingBalanceAmount,
      ).toBeUndefined();
    }
    expect(
      validate({ ...base, fullName: 'Jane', phone: '03123456', openingBalanceAmount: '-5' }, CTX)
        .openingBalanceAmount,
    ).toBe('negativeAmount');
    expect(
      validate(
        { ...base, fullName: 'Jane', phone: '03123456', openingBalanceAmount: '12345678901' },
        CTX,
      ).openingBalanceAmount,
    ).toBe('invalidAmount');
    expect(
      validate({ ...base, fullName: 'Jane', phone: '03123456', openingBalanceAmount: '50' }, CTX)
        .openingBalanceAmount,
    ).toBeUndefined();
  });

  it('accepts a leading/trailing dot amount (normalised before the format check)', () => {
    expect(
      validate({ ...base, fullName: 'Jane', phone: '03123456', openingBalanceAmount: '.5' }, CTX)
        .openingBalanceAmount,
    ).toBeUndefined();
  });

  it('rejects an opening-balance as-of date after today', () => {
    expect(
      validate(
        {
          ...base,
          fullName: 'Jane',
          phone: '03123456',
          openingBalanceAmount: '50',
          openingBalanceAsOf: '2026-09-28',
        },
        CTX,
      ).openingBalanceAsOf,
    ).toBe('futureDate');
  });

  it('flags an opening-balance note over 200 characters', () => {
    expect(
      validate(
        {
          ...base,
          fullName: 'Jane',
          phone: '03123456',
          openingBalanceAmount: '50',
          openingBalanceNote: 'x'.repeat(201),
        },
        CTX,
      ).openingBalanceNote,
    ).toBe('tooLong');
  });

  it('ignores As of and Note without an amount above zero (nothing is recorded)', () => {
    for (const openingBalanceAmount of ['', '0', 'abc']) {
      const errors = validate(
        {
          ...base,
          fullName: 'Jane',
          phone: '03123456',
          openingBalanceAmount,
          openingBalanceAsOf: '2026-09-28',
          openingBalanceNote: 'x'.repeat(201),
        },
        CTX,
      );
      expect(errors.openingBalanceAsOf).toBeUndefined();
      expect(errors.openingBalanceNote).toBeUndefined();
    }
  });
});

describe('phoneOptional', () => {
  it('is false at exactly 18', () => {
    expect(phoneOptional({ ...emptyForm(), dateOfBirth: '2008-09-27' }, TODAY)).toBe(false);
  });

  it('is true at 17', () => {
    expect(phoneOptional({ ...emptyForm(), dateOfBirth: '2009-09-27' }, TODAY)).toBe(true);
  });

  it('is false with no date of birth set', () => {
    expect(phoneOptional(emptyForm(), TODAY)).toBe(false);
  });

  it('is false for a date of birth after today', () => {
    expect(phoneOptional({ ...emptyForm(), dateOfBirth: '2027-01-01' }, TODAY)).toBe(false);
  });

  it('is false while the date of birth is still partly typed', () => {
    expect(phoneOptional({ ...emptyForm(), dateOfBirth: '07/03/20' }, TODAY)).toBe(false);
  });
});

describe('toCreatePayload', () => {
  it("sends a minor's blank phone as null, and the dentist as a staff profile id", () => {
    const values: PatientFormValues = {
      ...emptyForm(),
      fullName: 'Jane',
      dateOfBirth: '2009-09-27',
      primaryDentistId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5e80',
    };
    const payload = toCreatePayload(values);
    expect(payload.phone).toBeNull();
    expect(payload.primaryDentistId).toBe('01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5e80');
    expect(payload).not.toHaveProperty('guardianName');
    expect(payload).not.toHaveProperty('emergencyContact');
  });
});

describe('isDirty', () => {
  it('is false for identical values and true after one field changes', () => {
    const initial = emptyForm({ fullName: 'Jane' });
    expect(isDirty(initial, { ...initial })).toBe(false);
    expect(isDirty(initial, { ...initial, phone: '03123456' })).toBe(true);
  });

  it('ignores leading/trailing whitespace only', () => {
    const initial = emptyForm({ fullName: 'Jane' });
    expect(isDirty(initial, { ...initial, fullName: '  Jane  ' })).toBe(false);
  });
});

describe('isEditDirty', () => {
  const initial = fromPatient(PATIENT, 'LB');

  it('is false for identical values', () => {
    expect(isEditDirty(initial, { ...initial }, 'LB')).toBe(false);
  });

  it('is false when the phone is re-typed in a different but equivalent format', () => {
    // initial.phone is '03 123 456' (fromPatient's national display); this must not read as
    // "Unsaved" just because the field's raw text differs while the number is the same.
    const current = { ...initial, phone: '03123456' };
    expect(isEditDirty(initial, current, 'LB')).toBe(false);
  });

  it('is true once a field actually changes', () => {
    const current = { ...initial, address: '2 Second St' };
    expect(isEditDirty(initial, current, 'LB')).toBe(true);
  });

  it('does not throw while a field holds a value that is still being typed', () => {
    expect(isEditDirty(initial, { ...initial, email: 'jane@' }, 'LB')).toBe(true);
    expect(isEditDirty(initial, { ...initial, dateOfBirth: '07/03/20' }, 'LB')).toBe(true);
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
  const initial = fromPatient(PATIENT, 'LB');

  it('is null when nothing changed', () => {
    expect(toPatchPayload(initial, { ...initial }, 'LB')).toBeNull();
  });

  it('sends only the fields that changed', () => {
    const current = { ...initial, address: '2 Second St' };
    expect(toPatchPayload(initial, current, 'LB')).toEqual({ address: '2 Second St' });
  });

  it('is null when the phone is re-typed in a different but equivalent format', () => {
    // initial.phone is '03 123 456' (fromPatient's national display); re-typing the same number
    // without the spaces normalises to the same E.164 and so isn't a real change.
    const current = { ...initial, phone: '03123456' };
    expect(toPatchPayload(initial, current, 'LB')).toBeNull();
  });

  it('is null when only whitespace around text changes', () => {
    const current = { ...initial, address: `${initial.address} ` };
    expect(toPatchPayload(initial, current, 'LB')).toBeNull();
  });

  it('is null when the email only changes case', () => {
    const current = { ...initial, email: initial.email.toUpperCase() };
    expect(toPatchPayload(initial, current, 'LB')).toBeNull();
  });

  it("clears a minor's phone as null", () => {
    const minor = fromPatient({ ...PATIENT, dateOfBirth: '2015-01-01' }, 'LB');
    expect(toPatchPayload(minor, { ...minor, phone: '' }, 'LB')).toEqual({ phone: null });
  });

  it('sends a changed dentist as a staff profile id, and a cleared one as null', () => {
    const profile = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5e80';
    expect(toPatchPayload(initial, { ...initial, primaryDentistId: profile }, 'LB')).toEqual({
      primaryDentistId: profile,
    });
    const assigned = fromPatient({ ...PATIENT, primaryDentistId: profile }, 'LB');
    expect(toPatchPayload(assigned, { ...assigned, primaryDentistId: '' }, 'LB')).toEqual({
      primaryDentistId: null,
    });
  });
});

describe('amountValue', () => {
  it('reads a clean amount for the locale', () => {
    expect(amountValue('1,234.56', 'en')).toBe('1234.56');
    expect(amountValue('12,50', 'fr')).toBe('12.50');
    expect(amountValue('.5', 'en')).toBe('0.5');
    expect(amountValue('5.', 'en')).toBe('5');
  });

  it('keeps anything else as typed, so validation flags it', () => {
    for (const typed of ['12.505', '12abc']) {
      const value = amountValue(typed, 'en');
      expect(value).toBe(typed);
      expect(
        validate({ ...emptyForm(), openingBalanceAmount: value }, CTX).openingBalanceAmount,
      ).toBe('invalidAmount');
    }
  });
});

describe('wantsOpeningBalance / toOpeningBalance', () => {
  it('wants a balance only when the amount is greater than zero', () => {
    expect(wantsOpeningBalance({ ...emptyForm(), openingBalanceAmount: '' })).toBe(false);
    expect(wantsOpeningBalance({ ...emptyForm(), openingBalanceAmount: '0' })).toBe(false);
    expect(wantsOpeningBalance({ ...emptyForm(), openingBalanceAmount: '0.00' })).toBe(false);
    expect(wantsOpeningBalance({ ...emptyForm(), openingBalanceAmount: '50' })).toBe(true);
  });

  it('defaults asOf to today when left blank', () => {
    const balance = toOpeningBalance({ ...emptyForm(), openingBalanceAmount: '50' }, TODAY);
    expect(balance).toEqual({ amount: '50', asOf: TODAY, note: null });
  });

  it('normalises a leading/trailing dot amount before parsing', () => {
    expect(toOpeningBalance({ ...emptyForm(), openingBalanceAmount: '.5' }, TODAY).amount).toBe(
      '0.5',
    );
  });
});

describe('validate/payload-builder parity (property-style)', () => {
  // A small deterministic PRNG (mulberry32) rather than a new `fast-check` dependency: cheap,
  // reproducible, and enough to explore combinations no single example-based test would think of.
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(20260927);
  const pick = <T>(options: readonly T[]): T => options[Math.floor(rand() * options.length)]!;

  const NAMES = ['', 'Jane Doe', 'x'.repeat(200), '  Jane  '];
  const PHONES = ['', '03123456', '03 123 456', '12', '+33612345678', 'not a phone'];
  const DOBS = ['', '1990-01-01', '2009-09-27', '2027-01-01', '2026-13-45', '1899-01-01'];
  const EMAILS = ['', 'jane@example.com', 'not-an-email'];
  const ALERTS = [
    '',
    'Penicillin, Latex',
    'x'.repeat(61),
    Array.from({ length: 25 }, (_, i) => `Alert ${i}`).join(','),
  ];
  const AMOUNTS = ['', '0', '50', '-5', 'abc', '.5', '5.', '12345678901.00'];
  const AS_OFS = ['', '2026-09-20', '2026-09-28', '2026-13-01'];
  const SEXES: PatientSex[] = ['unknown', 'female', 'male', 'other'];

  function randomValues(): PatientFormValues {
    return {
      ...emptyForm(),
      fullName: pick(NAMES),
      phone: pick(PHONES),
      dateOfBirth: pick(DOBS),
      sex: pick(SEXES),
      email: pick(EMAILS),
      address: '',
      insurance: '',
      alertsText: pick(ALERTS),
      primaryDentistId: '',
      notes: '',
      openingBalanceAmount: pick(AMOUNTS),
      openingBalanceAsOf: pick(AS_OFS),
      openingBalanceNote: '',
    };
  }

  it('never throws in the payload builders for any combination validate() accepts', () => {
    let checkedAtLeastOneValidCombination = false;
    for (let i = 0; i < 2000; i++) {
      const values = randomValues();
      const errors = validate(values, CTX);
      if (Object.keys(errors).length > 0) continue;
      checkedAtLeastOneValidCombination = true;

      expect(() => toCreatePayload(values)).not.toThrow();
      expect(() => toPatchPayload(emptyForm(), values, CTX.country)).not.toThrow();
      if (wantsOpeningBalance(values)) {
        expect(() => toOpeningBalance(values, TODAY)).not.toThrow();
      }
    }
    // A meta-check on the test itself: if this ever goes false, the generators above are too
    // narrow to produce any value validate() accepts, and the property test isn't testing anything.
    expect(checkedAtLeastOneValidCombination).toBe(true);
  });
});
