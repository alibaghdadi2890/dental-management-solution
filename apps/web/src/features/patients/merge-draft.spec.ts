import type { Patient } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  alertsOverflow,
  differingFields,
  mergeDraft,
  mergePhoneMissing,
  preview,
  swapKeep,
  toMergePayload,
} from './merge-draft';

const ID_A = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_B = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';
const ID_C = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70';
const ID_D = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d71';

function patient(overrides: Partial<Patient>): Patient {
  return {
    id: ID_A,
    displayNumber: 'P-000001',
    fullName: 'Jane Doe',
    phone: '+9613123456',
    dateOfBirth: '1990-01-01',
    sex: 'female',
    email: 'jane@example.com',
    address: '1 Main St',
    insurance: null,
    medicalAlerts: [],
    primaryDentistId: null,
    notes: null,
    dentitionOverride: null,
    externalId: null,
    archivedAt: null,
    mergedIntoId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const older = patient({ id: ID_A, displayNumber: 'P-000001', address: '1 Main St' });
const newer = patient({
  id: ID_B,
  displayNumber: 'P-000002',
  address: '2 Second St',
  phone: '+9613654321',
});

describe('differingFields', () => {
  it('lists only the fields that actually differ', () => {
    expect(differingFields(older, newer)).toEqual(['phone', 'address']);
  });

  it('compares the dentist by staff profile id, and a missing phone like any value', () => {
    const a = patient({ primaryDentistId: ID_C, phone: null });
    const b = patient({ primaryDentistId: ID_D });
    expect(differingFields(a, b)).toEqual(['phone', 'primaryDentistId']);
    expect(preview({ ...mergeDraft(b, a), choices: { phone: 'drop' } }).phone).toBeNull();
  });

  it('is empty for two otherwise-identical records', () => {
    expect(differingFields(older, patient({ id: ID_B, displayNumber: 'P-000002' }))).toEqual([]);
  });
});

describe('mergeDraft', () => {
  it('defaults keepId to the older (lower display number) record', () => {
    expect(mergeDraft(older, newer).keepId).toBe(ID_A);
    expect(mergeDraft(newer, older).keepId).toBe(ID_A);
  });

  it('compares display numbers numerically, not lexicographically', () => {
    const grown = patient({ id: ID_C, displayNumber: 'P-1000000' });
    const sixDigit = patient({ id: ID_D, displayNumber: 'P-999999' });
    expect(mergeDraft(grown, sixDigit).keepId).toBe(ID_D);
  });

  it('defaults every differing field to keep', () => {
    const draft = mergeDraft(older, newer);
    expect(draft.choices).toEqual({ phone: 'keep', address: 'keep' });
  });
});

describe('swapKeep', () => {
  it('flips which record survives without touching the choices', () => {
    const draft = mergeDraft(older, newer);
    const swapped = swapKeep(draft);
    expect(swapped.keepId).toBe(ID_B);
    expect(swapped.choices).toEqual(draft.choices);
  });

  it('changes what a default choice resolves to', () => {
    const draft = mergeDraft(older, newer);
    expect(preview(draft).phone).toBe(older.phone);
    expect(preview(swapKeep(draft)).phone).toBe(newer.phone);
  });
});

describe('preview', () => {
  it('resolves a kept field from the surviving record', () => {
    const draft = mergeDraft(older, newer);
    expect(preview(draft).address).toBe(older.address);
  });

  it('resolves a drop-chosen field from the other record', () => {
    const draft = mergeDraft(older, newer);
    const withDrop = { ...draft, choices: { ...draft.choices, address: 'drop' as const } };
    expect(preview(withDrop).address).toBe(newer.address);
  });

  it('unions medical alerts, kept record first, regardless of field choices', () => {
    const a = patient({
      id: ID_A,
      displayNumber: 'P-000001',
      medicalAlerts: ['Penicillin', 'Latex'],
    });
    const b = patient({ id: ID_B, displayNumber: 'P-000002', medicalAlerts: ['latex', 'Nuts'] });
    expect(preview(mergeDraft(a, b)).medicalAlerts).toEqual(['Penicillin', 'Latex', 'Nuts']);
  });
});

describe('mergePhoneMissing', () => {
  const TODAY = '2026-09-27';
  const phoneless = patient({ id: ID_B, displayNumber: 'P-000002', phone: null });

  it('is true when an adult survivor would take the missing phone', () => {
    const draft = mergeDraft(older, phoneless);
    expect(mergePhoneMissing(draft, TODAY)).toBe(false);
    expect(mergePhoneMissing({ ...draft, choices: { phone: 'drop' } }, TODAY)).toBe(true);
  });

  it('treats a survivor without a date of birth as an adult', () => {
    const noDob = patient({ dateOfBirth: null });
    const draft = mergeDraft(noDob, { ...phoneless, dateOfBirth: null });
    expect(mergePhoneMissing({ ...draft, choices: { phone: 'drop' } }, TODAY)).toBe(true);
  });

  it("is false for a minor on the tenant's today", () => {
    const minor = patient({ dateOfBirth: '2015-01-01' });
    const draft = mergeDraft(minor, { ...phoneless, dateOfBirth: '2015-01-01' });
    expect(mergePhoneMissing({ ...draft, choices: { phone: 'drop' } }, TODAY)).toBe(false);
  });

  it('is true when a phoneless minor survivor takes an adult date of birth', () => {
    const minor = patient({ phone: null, dateOfBirth: '2015-01-01' });
    const adult = patient({ id: ID_B, displayNumber: 'P-000002', phone: null });
    const draft = mergeDraft(minor, adult);
    expect(mergePhoneMissing(draft, TODAY)).toBe(false);
    expect(mergePhoneMissing({ ...draft, choices: { dateOfBirth: 'drop' } }, TODAY)).toBe(true);
  });

  it('is false when the merge changes neither the phone nor the date of birth', () => {
    // A phoneless patient who has since come of age, merged with an identical twin record.
    const agedOut = patient({ phone: null });
    const twin = patient({ id: ID_B, displayNumber: 'P-000002', phone: null, notes: 'x' });
    expect(mergePhoneMissing({ ...mergeDraft(agedOut, twin), choices: {} }, TODAY)).toBe(false);
  });
});

describe('alertsOverflow', () => {
  it('is false when the union fits', () => {
    expect(alertsOverflow(mergeDraft(older, newer))).toBe(false);
  });

  it('is true once the union exceeds MEDICAL_ALERTS_MAX', () => {
    const a = patient({
      id: ID_A,
      displayNumber: 'P-000001',
      medicalAlerts: Array.from({ length: 15 }, (_, i) => `Alert A${i}`),
    });
    const b = patient({
      id: ID_B,
      displayNumber: 'P-000002',
      medicalAlerts: Array.from({ length: 10 }, (_, i) => `Alert B${i}`),
    });
    expect(alertsOverflow(mergeDraft(a, b))).toBe(true);
  });
});

describe('toMergePayload', () => {
  it('builds a valid payload with dropId as the other record', () => {
    const draft = mergeDraft(older, newer);
    const payload = toMergePayload(draft, 'Confirmed duplicate at front desk');
    expect(payload).toEqual({
      keepId: ID_A,
      dropId: ID_B,
      fieldChoices: { phone: 'keep', address: 'keep' },
      reason: 'Confirmed duplicate at front desk',
    });
  });

  it('throws for a reason under 3 trimmed characters', () => {
    const draft = mergeDraft(older, newer);
    expect(() => toMergePayload(draft, 'ok')).toThrow();
    expect(() => toMergePayload(draft, '  ')).toThrow();
  });
});
