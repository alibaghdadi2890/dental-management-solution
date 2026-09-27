import { describe, expect, it } from 'vitest';
import {
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
