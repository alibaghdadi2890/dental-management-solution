import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEDICAL_HISTORY,
  isHistoryAsked,
  medicalHistoryInputSchema,
  medicalOptionBatchSchema,
  toMedicalHistoryInput,
} from './medical-history.js';

const PENICILLIN = '0198c0de-0000-7000-8000-000000000001';
const LATEX = '0198c0de-0000-7000-8000-000000000002';

describe('medicalHistoryInputSchema', () => {
  it('reads an empty input as "not asked"', () => {
    expect(medicalHistoryInputSchema.parse({})).toEqual(
      toMedicalHistoryInput(EMPTY_MEDICAL_HISTORY),
    );
  });

  it('refuses "none" together with items of the same list', () => {
    const allergies = medicalHistoryInputSchema.safeParse({
      noKnownAllergies: true,
      allergyIds: [PENICILLIN],
    });
    expect(allergies.success).toBe(false);
    expect(allergies.error?.issues[0]?.path).toEqual(['noKnownAllergies']);
    expect(
      medicalHistoryInputSchema.safeParse({ noConditions: true, conditionIds: [LATEX] }).success,
    ).toBe(false);
    // "None known" for allergies says nothing about conditions.
    expect(
      medicalHistoryInputSchema.safeParse({ noKnownAllergies: true, conditionIds: [LATEX] })
        .success,
    ).toBe(true);
  });

  it('refuses the same item twice and blanks an empty medication line', () => {
    expect(
      medicalHistoryInputSchema.safeParse({ allergyIds: [PENICILLIN, PENICILLIN] }).success,
    ).toBe(false);
    expect(medicalHistoryInputSchema.parse({ medication: '   ' }).medication).toBeNull();
  });
});

describe('isHistoryAsked', () => {
  it('is false until a list or the medication line has an answer', () => {
    expect(isHistoryAsked(EMPTY_MEDICAL_HISTORY)).toBe(false);
    expect(isHistoryAsked({ ...EMPTY_MEDICAL_HISTORY, noKnownAllergies: true })).toBe(true);
    expect(
      isHistoryAsked({
        ...EMPTY_MEDICAL_HISTORY,
        conditions: [{ id: LATEX, name: 'Asthma' }],
      }),
    ).toBe(true);
    expect(isHistoryAsked({ ...EMPTY_MEDICAL_HISTORY, medication: 'Warfarin' })).toBe(true);
  });
});

describe('medicalOptionBatchSchema', () => {
  it('refuses a name twice in one list, whatever its case, and allows it in the other list', () => {
    const twice = medicalOptionBatchSchema.safeParse({
      items: [
        { kind: 'allergy', name: 'Latex' },
        { kind: 'allergy', name: ' latex ' },
      ],
    });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.path).toEqual(['items', 1, 'name']);
    expect(
      medicalOptionBatchSchema.safeParse({
        items: [
          { kind: 'allergy', name: 'Asthma' },
          { kind: 'condition', name: 'Asthma' },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses the same row twice and defaults a new row to active', () => {
    expect(
      medicalOptionBatchSchema.safeParse({
        items: [
          { id: PENICILLIN, kind: 'allergy', name: 'Penicillin' },
          { id: PENICILLIN, kind: 'allergy', name: 'Penicillins' },
        ],
      }).success,
    ).toBe(false);
    expect(
      medicalOptionBatchSchema.parse({ items: [{ kind: 'condition', name: ' Diabetes ' }] })
        .items[0],
    ).toEqual({ kind: 'condition', name: 'Diabetes', active: true });
  });
});
