import { describe, expect, it } from 'vitest';
import {
  dentitionOverrideSchema,
  MERGE_FIELDS,
  medicalAlertsSchema,
  patientArchiveSchema,
  patientCreateSchema,
  patientInputSchema,
  patientListQuerySchema,
  patientMergeSchema,
  patientPageSchema,
  patientPatchSchema,
  patientSchema,
  profileCompleteness,
} from './patients.js';

const ID_A = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_B = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

describe('profileCompleteness', () => {
  const full = { email: 'a@b.io', address: '1 Main St' };

  it('is complete for an adult only when both email and address are present', () => {
    const adult = { minor: false, hasGuardian: false };
    expect(profileCompleteness({ ...full, ...adult })).toBe('complete');
    expect(profileCompleteness({ ...full, email: null, ...adult })).toBe('partial');
    expect(profileCompleteness({ ...full, address: null, ...adult })).toBe('partial');
    expect(profileCompleteness({ email: null, address: null, ...adult })).toBe('partial');
  });

  it('never asks an adult for a guardian', () => {
    expect(profileCompleteness({ ...full, minor: false, hasGuardian: true })).toBe('complete');
  });

  it('asks a minor for a guardian too (design addendum C10)', () => {
    expect(profileCompleteness({ ...full, minor: true, hasGuardian: true })).toBe('complete');
    expect(profileCompleteness({ ...full, minor: true, hasGuardian: false })).toBe('partial');
    expect(
      profileCompleteness({ email: null, address: '1 Main St', minor: true, hasGuardian: true }),
    ).toBe('partial');
  });
});

describe('medicalAlertsSchema', () => {
  it('trims and de-duplicates case-insensitively, keeping the first occurrence', () => {
    expect(medicalAlertsSchema.parse([' Penicillin ', 'penicillin', 'Latex'])).toEqual([
      'Penicillin',
      'Latex',
    ]);
  });

  it('collapses NFC/NFD variants of the same alert (e.g. "Café")', () => {
    const nfd = 'Café'; // "e" + combining acute accent (U+0301)
    const nfc = 'Café'; // precomposed "é" (U+00E9)
    expect(medicalAlertsSchema.parse([nfd, nfc])).toEqual(['Café']);
    // The stored value is normalized to NFC even when it's the only occurrence.
    expect(medicalAlertsSchema.parse([nfd])[0]).toBe('Café');
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

  it('normalizes to NFC before enforcing the 60-character max, not after', () => {
    // 60 composed characters, typed in decomposed form: "e" + combining acute (U+0301) each,
    // so the raw string is 120 UTF-16 code units before normalization collapses it to 60.
    const decomposed = 'é'.repeat(60);
    const composed = 'é'.repeat(60);
    expect(decomposed).toHaveLength(120);
    expect(composed).toHaveLength(60);
    expect(medicalAlertsSchema.parse([decomposed])).toEqual([composed]);
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

  it('treats a blank, null or absent date of birth as null', () => {
    expect(patientInputSchema.parse({ ...input, dateOfBirth: '' }).dateOfBirth).toBeNull();
    expect(patientInputSchema.parse({ ...input, dateOfBirth: null }).dateOfBirth).toBeNull();
    expect(patientInputSchema.parse(input).dateOfBirth).toBeNull();
  });

  it('rejects a date of birth in the future', () => {
    expect(patientInputSchema.safeParse({ ...input, dateOfBirth: '2099-01-01' }).success).toBe(
      false,
    );
  });

  it('rejects an implausible date of birth before 1900', () => {
    expect(patientInputSchema.safeParse({ ...input, dateOfBirth: '1899-12-31' }).success).toBe(
      false,
    );
    expect(patientInputSchema.safeParse({ ...input, dateOfBirth: '1900-01-01' }).success).toBe(
      true,
    );
  });

  it('validates an email only when present', () => {
    expect(patientInputSchema.safeParse({ ...input, email: 'not-an-email' }).success).toBe(false);
    expect(patientInputSchema.parse({ ...input, email: 'Jane@Example.com' }).email).toBe(
      'jane@example.com',
    );
  });

  it('treats a blank, null or absent phone as null: the adult-only rule is server-side', () => {
    expect(patientInputSchema.parse({ fullName: 'Jane Doe' }).phone).toBeNull();
    expect(patientInputSchema.parse({ ...input, phone: '  ' }).phone).toBeNull();
    expect(patientInputSchema.parse({ ...input, phone: null }).phone).toBeNull();
    expect(patientInputSchema.safeParse({ ...input, phone: '1'.repeat(41) }).success).toBe(false);
  });

  it('takes the primary dentist as a staff profile id under primaryDentistId', () => {
    const parsed = patientInputSchema.parse({ ...input, primaryDentistId: ID_A });
    expect(parsed.primaryDentistId).toBe(ID_A);
    expect(patientInputSchema.parse(input).primaryDentistId).toBeNull();
    expect(patientInputSchema.parse({ ...input, primaryDentistUserId: ID_A })).not.toHaveProperty(
      'primaryDentistUserId',
    );
  });

  it('has no guardian or emergency-contact text fields (contacts replace them)', () => {
    const parsed = patientInputSchema.parse({
      ...input,
      guardianName: 'Mary Doe',
      guardianPhone: '03 999 999',
      emergencyContact: 'Mary Doe',
    });
    expect(parsed).not.toHaveProperty('guardianName');
    expect(parsed).not.toHaveProperty('guardianPhone');
    expect(parsed).not.toHaveProperty('emergencyContact');
  });

  it('drops externalId: only the import (feature 6) sets it', () => {
    expect(patientInputSchema.parse({ ...input, externalId: 'EXT-1' })).not.toHaveProperty(
      'externalId',
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

  it('clears the date of birth when explicitly patched to null, without touching other fields', () => {
    const parsed = patientPatchSchema.parse({ dateOfBirth: null });
    expect(parsed).toEqual({ dateOfBirth: null });
  });

  it('rejects a patch of externalId alone: it is not an editable field', () => {
    expect(patientPatchSchema.safeParse({ externalId: 'EXT-1' }).success).toBe(false);
  });

  it('clears the phone when patched to blank or null, and leaves it untouched when absent', () => {
    expect(patientPatchSchema.parse({ phone: '' })).toEqual({ phone: null });
    expect(patientPatchSchema.parse({ phone: null })).toEqual({ phone: null });
    expect(patientPatchSchema.parse({ notes: 'x' })).not.toHaveProperty('phone');
  });

  it('rejects a patch of the removed guardian fields alone', () => {
    expect(patientPatchSchema.safeParse({ guardianName: 'Mary' }).success).toBe(false);
    expect(patientPatchSchema.safeParse({ emergencyContact: 'Mary' }).success).toBe(false);
  });

  it('leaves the date of birth untouched when the key is absent', () => {
    const parsed = patientPatchSchema.parse({ notes: 'Follow up' });
    expect(parsed).not.toHaveProperty('dateOfBirth');
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

  it('treats blank query params as absent rather than 400ing', () => {
    const parsed = patientListQuerySchema.parse({
      dentist: '',
      age: '',
      alerts: '',
      lastVisit: '',
      view: '',
      sort: '',
      dir: '',
      page: '',
      size: '',
    });
    expect(parsed).toMatchObject({
      view: 'active',
      sort: 'name',
      dir: 'asc',
      page: 1,
      size: 25,
    });
    expect(parsed.dentist).toBeUndefined();
    expect(parsed.age).toBeUndefined();
    expect(parsed.alerts).toBeUndefined();
    expect(parsed.lastVisit).toBeUndefined();
  });

  it('still rejects a non-blank, unsupported value', () => {
    expect(patientListQuerySchema.safeParse({ view: 'bogus' }).success).toBe(false);
    expect(patientListQuerySchema.safeParse({ age: 'toddler' }).success).toBe(false);
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
      primaryDentistId: null,
      email: null,
      archivedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      primaryGuardian: null,
      matchedContact: null,
    };
    const page = { items: [item], total: 1, page: 1, size: 25 };
    expect(patientPageSchema.parse(page)).toEqual(page);
    expect(patientPageSchema.safeParse({ ...page, total: -1 }).success).toBe(false);
  });

  it('accepts a list item without a phone (a minor) and never carries guardian fields', () => {
    const item = {
      id: ID_A,
      displayNumber: 'P-000001',
      fullName: 'Sam Doe',
      phone: null,
      dateOfBirth: '2020-01-01',
      sex: 'unknown',
      medicalAlerts: [],
      primaryDentistId: ID_B,
      email: null,
      archivedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      primaryGuardian: {
        contactId: ID_A,
        fullName: 'Mona Doe',
        phone: '+9613123456',
        relationship: 'parent',
      },
      matchedContact: { fullName: 'Mona Doe', relationship: 'parent' },
    };
    const parsed = patientPageSchema.parse({ items: [item], total: 1, page: 1, size: 25 });
    expect(parsed.items[0]).toEqual(item);
    expect(parsed.items[0]).not.toHaveProperty('guardianName');
  });

  it('requires primaryGuardian and matchedContact on every list item (null when none)', () => {
    const item = {
      id: ID_A,
      displayNumber: 'P-000001',
      fullName: 'Sam Doe',
      phone: null,
      dateOfBirth: null,
      sex: 'unknown',
      medicalAlerts: [],
      primaryDentistId: null,
      email: null,
      archivedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      primaryGuardian: null,
      matchedContact: null,
    };
    const page = (items: unknown[]) => ({ items, total: 1, page: 1, size: 25 });
    expect(patientPageSchema.safeParse(page([item])).success).toBe(true);
    const { primaryGuardian: _guardian, ...withoutGuardian } = item;
    expect(patientPageSchema.safeParse(page([withoutGuardian])).success).toBe(false);
    const { matchedContact: _matched, ...withoutMatched } = item;
    expect(patientPageSchema.safeParse(page([withoutMatched])).success).toBe(false);
    expect(
      patientPageSchema.safeParse(
        page([{ ...item, matchedContact: { fullName: 'X', relationship: 'uncle' } }]),
      ).success,
    ).toBe(false);
  });
});

describe('patientCreateSchema', () => {
  const base = { fullName: 'Sam Doe', dateOfBirth: '2020-01-01' };
  const guardian = {
    target: { newContact: { fullName: 'Mona Doe', phone: '03 123 456' } },
    relationship: 'parent',
    isGuardian: true,
    isBillingContact: true,
  };

  it('is the patient input plus contacts (default none) and an optional linkContactId', () => {
    const parsed = patientCreateSchema.parse(base);
    expect(parsed.contacts).toEqual([]);
    expect(parsed.linkContactId).toBeUndefined();
    expect(parsed.sex).toBe('unknown');
    const withContacts = patientCreateSchema.parse({
      ...base,
      contacts: [guardian],
      linkContactId: ID_A,
    });
    expect(withContacts.contacts).toEqual([
      {
        target: { newContact: { fullName: 'Mona Doe', phone: '03 123 456', email: null } },
        relationship: 'parent',
        isGuardian: true,
        isBillingContact: true,
        isEmergencyContact: false,
      },
    ]);
    expect(withContacts.linkContactId).toBe(ID_A);
  });

  it('links at most 10 contacts', () => {
    const link = (index: number) => ({
      ...guardian,
      target: { newContact: { fullName: `Contact ${String(index)}`, phone: '03 123 456' } },
    });
    const contacts = (count: number) => Array.from({ length: count }, (_, index) => link(index));
    expect(patientCreateSchema.safeParse({ ...base, contacts: contacts(10) }).success).toBe(true);
    expect(patientCreateSchema.safeParse({ ...base, contacts: contacts(11) }).success).toBe(false);
  });

  it('validates each link and refuses the same contact or patient twice', () => {
    expect(
      patientCreateSchema.safeParse({
        ...base,
        contacts: [{ ...guardian, isGuardian: false, isBillingContact: false }],
      }).success,
    ).toBe(false);
    const byContact = { ...guardian, target: { contactId: ID_A } };
    const byPatient = { ...guardian, target: { patientId: ID_B } };
    expect(
      patientCreateSchema.safeParse({ ...base, contacts: [byContact, byPatient] }).success,
    ).toBe(true);
    expect(
      patientCreateSchema.safeParse({ ...base, contacts: [byContact, byContact] }).success,
    ).toBe(false);
    expect(
      patientCreateSchema.safeParse({ ...base, contacts: [byPatient, byPatient] }).success,
    ).toBe(false);
    // Two new contacts may share a name: they are different people until someone links them.
    expect(patientCreateSchema.safeParse({ ...base, contacts: [guardian, guardian] }).success).toBe(
      true,
    );
  });

  it('refuses linkContactId naming one of the new patient’s own contacts', () => {
    const byContact = { ...guardian, target: { contactId: ID_A } };
    const result = patientCreateSchema.safeParse({
      ...base,
      contacts: [byContact],
      linkContactId: ID_A,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['linkContactId']);
  });

  it('rejects a linkContactId that is not a uuid', () => {
    expect(patientCreateSchema.safeParse({ ...base, linkContactId: 'x' }).success).toBe(false);
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

  it('has no guardian or emergencyContact merge field, and renames the dentist field', () => {
    expect(MERGE_FIELDS).toEqual([
      'fullName',
      'phone',
      'dateOfBirth',
      'sex',
      'email',
      'address',
      'insurance',
      'primaryDentistId',
      'notes',
    ]);
    expect(
      patientMergeSchema.safeParse({ ...base, fieldChoices: { guardian: 'drop' } }).success,
    ).toBe(false);
    expect(
      patientMergeSchema.safeParse({ ...base, fieldChoices: { emergencyContact: 'drop' } }).success,
    ).toBe(false);
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

describe('patientSchema', () => {
  const record = {
    id: ID_A,
    displayNumber: 'P-000001',
    fullName: 'Jane Doe',
    phone: '+9613123456',
    dateOfBirth: null,
    sex: 'unknown',
    email: null,
    address: null,
    insurance: null,
    medicalAlerts: [],
    primaryDentistId: null,
    notes: null,
    dentitionOverride: null,
    externalId: null,
    archivedAt: null,
    mergedIntoId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('requires dentitionOverride (spec W14), accepting a stage or null', () => {
    expect(patientSchema.parse(record).dentitionOverride).toBeNull();
    expect(patientSchema.parse({ ...record, dentitionOverride: 'mixed' }).dentitionOverride).toBe(
      'mixed',
    );
    const { dentitionOverride: _omitted, ...withoutOverride } = record;
    expect(patientSchema.safeParse(withoutOverride).success).toBe(false);
  });

  it('rejects an unknown dentition stage', () => {
    expect(patientSchema.safeParse({ ...record, dentitionOverride: 'baby' }).success).toBe(false);
  });
});

describe('dentitionOverrideSchema', () => {
  it('accepts each dentition stage and null (back to auto)', () => {
    expect(dentitionOverrideSchema.parse({ override: 'mixed' }).override).toBe('mixed');
    expect(dentitionOverrideSchema.parse({ override: null }).override).toBeNull();
  });

  it('rejects an unknown stage and a missing override', () => {
    expect(dentitionOverrideSchema.safeParse({ override: 'baby' }).success).toBe(false);
    expect(dentitionOverrideSchema.safeParse({}).success).toBe(false);
  });
});
