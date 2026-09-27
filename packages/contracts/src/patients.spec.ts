import { describe, expect, it } from 'vitest';
import {
  ageBand,
  ageBandBounds,
  ageOn,
  dentitionStage,
  isMinor,
  medicalAlertsSchema,
  patientArchiveSchema,
  patientInputSchema,
  patientListQuerySchema,
  patientMergeSchema,
  patientPageSchema,
  patientPatchSchema,
  profileCompleteness,
} from './patients.js';

const ID_A = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_B = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

describe('ageOn', () => {
  it('turns a year older the day before and on the birthday', () => {
    expect(ageOn('2020-09-27', '2026-09-26')).toBe(5);
    expect(ageOn('2020-09-27', '2026-09-27')).toBe(6);
    expect(ageOn('2013-09-27', '2026-09-26')).toBe(12);
    expect(ageOn('2013-09-27', '2026-09-27')).toBe(13);
  });

  it('turns a Feb-29 birthday a year older on Mar 1 in a non-leap year', () => {
    expect(ageOn('2012-02-29', '2027-02-28')).toBe(14);
    expect(ageOn('2012-02-29', '2027-03-01')).toBe(15);
    expect(ageOn('2012-02-29', '2028-02-29')).toBe(16);
  });
});

describe('dentitionStage', () => {
  it('maps age to primary/mixed/permanent at the 5/6 and 12/13 boundaries', () => {
    expect(dentitionStage(5)).toBe('primary');
    expect(dentitionStage(6)).toBe('mixed');
    expect(dentitionStage(12)).toBe('mixed');
    expect(dentitionStage(13)).toBe('permanent');
  });
});

describe('isMinor', () => {
  it('is true the day before 18 and false exactly at 18', () => {
    expect(isMinor('2008-09-28', '2026-09-27')).toBe(true);
    expect(isMinor('2008-09-27', '2026-09-27')).toBe(false);
  });
});

describe('ageBandBounds', () => {
  const today = '2026-09-27';

  it('is consistent with ageOn/ageBand around the 18 and 65 boundaries, incl. Feb 29', () => {
    const dobs = [
      '2008-09-26',
      '2008-09-27',
      '2008-09-28',
      '1961-09-26',
      '1961-09-27',
      '1961-09-28',
      '2004-02-29', // dob on a leap day; today is not Feb 29
      '1961-02-28',
      '1961-03-01',
    ];
    for (const dob of dobs) {
      const age = ageOn(dob, today);
      const band = ageBand(age);
      const bounds = ageBandBounds(band, today);
      if (bounds.after !== undefined) expect(dob > bounds.after).toBe(true);
      if (bounds.onOrBefore !== undefined) expect(dob <= bounds.onOrBefore).toBe(true);
    }
  });

  it('places a Feb-29 "today" boundary on Feb 28 of the non-leap threshold year', () => {
    const bounds = ageBandBounds('child', '2028-02-29');
    expect(bounds.after).toBe('2010-02-28');
  });
});

describe('profileCompleteness', () => {
  it('is complete only when both email and address are present', () => {
    expect(profileCompleteness({ email: 'a@b.io', address: '1 Main St' })).toBe('complete');
    expect(profileCompleteness({ email: null, address: '1 Main St' })).toBe('partial');
    expect(profileCompleteness({ email: 'a@b.io', address: null })).toBe('partial');
    expect(profileCompleteness({ email: null, address: null })).toBe('partial');
  });
});

describe('medicalAlertsSchema', () => {
  it('trims and de-duplicates case-insensitively, keeping the first occurrence', () => {
    expect(medicalAlertsSchema.parse([' Penicillin ', 'penicillin', 'Latex'])).toEqual([
      'Penicillin',
      'Latex',
    ]);
  });

  it('caps at 20 items and rejects an item over 60 characters', () => {
    expect(
      medicalAlertsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `Alert ${i}`)).success,
    ).toBe(false);
    expect(medicalAlertsSchema.safeParse(['A'.repeat(61)]).success).toBe(false);
    expect(
      medicalAlertsSchema.safeParse(Array.from({ length: 20 }, (_, i) => `Alert ${i}`)).success,
    ).toBe(true);
  });
});

describe('patientInputSchema', () => {
  const input = { fullName: '  Jane Doe ', phone: ' 03 123 456 ' };

  it('trims fields and treats blank optionals as null', () => {
    const parsed = patientInputSchema.parse({ ...input, address: '  ', email: '' });
    expect(parsed.fullName).toBe('Jane Doe');
    expect(parsed.phone).toBe('03 123 456');
    expect(parsed.address).toBeNull();
    expect(parsed.email).toBeNull();
  });

  it('defaults sex to unknown and medicalAlerts to an empty array', () => {
    const parsed = patientInputSchema.parse(input);
    expect(parsed.sex).toBe('unknown');
    expect(parsed.medicalAlerts).toEqual([]);
  });

  it('rejects a date of birth in the future', () => {
    expect(patientInputSchema.safeParse({ ...input, dateOfBirth: '2099-01-01' }).success).toBe(
      false,
    );
  });

  it('validates an email only when present', () => {
    expect(patientInputSchema.safeParse({ ...input, email: 'not-an-email' }).success).toBe(false);
    expect(patientInputSchema.parse({ ...input, email: 'Jane@Example.com' }).email).toBe(
      'jane@example.com',
    );
  });
});

describe('patientPatchSchema', () => {
  it('rejects an empty patch', () => {
    expect(patientPatchSchema.safeParse({}).success).toBe(false);
  });

  it('never injects the sex or medicalAlerts defaults for an untouched patch', () => {
    const parsed = patientPatchSchema.parse({ notes: 'Follow up' });
    expect(parsed).toEqual({ notes: 'Follow up' });
    expect(parsed).not.toHaveProperty('sex');
    expect(parsed).not.toHaveProperty('medicalAlerts');
  });
});

describe('patientListQuerySchema', () => {
  it('applies the defaults', () => {
    expect(patientListQuerySchema.parse({})).toMatchObject({
      view: 'active',
      sort: 'name',
      dir: 'asc',
      page: 1,
      size: 25,
    });
  });

  it('rejects an unsupported page size and coerces string numbers', () => {
    expect(patientListQuerySchema.safeParse({ size: '30' }).success).toBe(false);
    expect(patientListQuerySchema.parse({ page: '2' }).page).toBe(2);
    expect(patientListQuerySchema.parse({ size: '50' }).size).toBe(50);
  });
});

describe('patientPageSchema', () => {
  it('wraps a page of list items with total, page and size (offset paging, design Q6)', () => {
    const item = {
      id: ID_A,
      displayNumber: 'P-000001',
      fullName: 'Jane Doe',
      phone: '+9613123456',
      dateOfBirth: null,
      sex: 'unknown',
      medicalAlerts: [],
      primaryDentistUserId: null,
      email: null,
      archivedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const page = { items: [item], total: 1, page: 1, size: 25 };
    expect(patientPageSchema.parse(page)).toEqual(page);
    expect(patientPageSchema.safeParse({ ...page, total: -1 }).success).toBe(false);
  });
});

describe('patientMergeSchema', () => {
  const base = { keepId: ID_A, dropId: ID_B, reason: 'Duplicate walk-in record' };

  it('rejects a reason shorter than 3 characters after trimming', () => {
    expect(patientMergeSchema.safeParse({ ...base, reason: '  a  ' }).success).toBe(false);
  });

  it('rejects merging a patient into itself', () => {
    expect(patientMergeSchema.safeParse({ ...base, dropId: ID_A }).success).toBe(false);
  });

  it('only accepts mergeable field keys in fieldChoices', () => {
    expect(
      patientMergeSchema.safeParse({ ...base, fieldChoices: { fullName: 'keep' } }).success,
    ).toBe(true);
    expect(patientMergeSchema.safeParse({ ...base, fieldChoices: { bogus: 'keep' } }).success).toBe(
      false,
    );
  });

  it('defaults fieldChoices to an empty object', () => {
    expect(patientMergeSchema.parse(base).fieldChoices).toEqual({});
  });
});

describe('patientArchiveSchema', () => {
  it('treats a blank reason as null and rejects duplicate ids', () => {
    expect(patientArchiveSchema.parse({ ids: [ID_A], reason: '  ' }).reason).toBeNull();
    expect(patientArchiveSchema.safeParse({ ids: [ID_A, ID_A] }).success).toBe(false);
  });
});
