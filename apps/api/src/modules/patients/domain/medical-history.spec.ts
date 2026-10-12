import type { MedicalHistoryInput } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  historyChanged,
  historyIssues,
  type KnownOption,
  mergeMedicalItems,
  type StoredMedicalHistory,
} from './medical-history';

const PENICILLIN = { id: 'penicillin', name: 'Penicillin' };
const LATEX = { id: 'latex', name: 'Latex' };
const ASTHMA = { id: 'asthma', name: 'Asthma' };

const stored = (patch: Partial<StoredMedicalHistory> = {}): StoredMedicalHistory => ({
  noKnownAllergies: false,
  allergies: [],
  noConditions: false,
  conditions: [],
  medication: null,
  ...patch,
});

const input = (patch: Partial<MedicalHistoryInput> = {}): MedicalHistoryInput => ({
  noKnownAllergies: false,
  allergyIds: [],
  noConditions: false,
  conditionIds: [],
  medication: null,
  ...patch,
});

const KNOWN: KnownOption[] = [
  { id: 'penicillin', kind: 'allergy', active: true },
  { id: 'latex', kind: 'allergy', active: false },
  { id: 'asthma', kind: 'condition', active: true },
];

describe('historyIssues', () => {
  it('accepts items of the right list', () => {
    expect(
      historyIssues(input({ allergyIds: ['penicillin'], conditionIds: ['asthma'] }), KNOWN, null),
    ).toEqual([]);
  });

  it('refuses an unknown id and an item of the other list, by its place in the list', () => {
    const issues = historyIssues(
      input({ allergyIds: ['penicillin', 'asthma'], conditionIds: ['gone'] }),
      KNOWN,
      null,
    );
    expect(issues.map(({ path, code }) => [path, code])).toEqual([
      ['medicalHistory.allergyIds.1', 'unknown_option'],
      ['medicalHistory.conditionIds.0', 'unknown_option'],
    ]);
  });

  it('refuses a newly picked inactive item, and keeps one the patient already has', () => {
    expect(historyIssues(input({ allergyIds: ['latex'] }), KNOWN, null)).toMatchObject([
      { path: 'medicalHistory.allergyIds.0', code: 'inactive_option' },
    ]);
    expect(
      historyIssues(input({ allergyIds: ['latex'] }), KNOWN, stored({ allergies: [LATEX] })),
    ).toEqual([]);
  });
});

describe('historyChanged', () => {
  it('ignores the order of the items', () => {
    const before = stored({ allergies: [PENICILLIN, LATEX] });
    expect(historyChanged(before, input({ allergyIds: ['latex', 'penicillin'] }))).toBe(false);
  });

  it('sees a flag, an item or the medication line change', () => {
    const before = stored({ allergies: [PENICILLIN] });
    expect(historyChanged(before, input({ allergyIds: ['penicillin', 'latex'] }))).toBe(true);
    expect(historyChanged(before, input({ noKnownAllergies: true }))).toBe(true);
    expect(
      historyChanged(before, input({ allergyIds: ['penicillin'], medication: 'Warfarin' })),
    ).toBe(true);
  });
});

describe('mergeMedicalItems', () => {
  it('unions the items of both records, the kept ones first', () => {
    expect(
      mergeMedicalItems(
        stored({ allergies: [PENICILLIN] }),
        stored({ allergies: [LATEX, PENICILLIN], conditions: [ASTHMA] }),
      ),
    ).toEqual({
      allergyIds: ['penicillin', 'latex'],
      noKnownAllergies: false,
      conditionIds: ['asthma'],
      noConditions: false,
    });
  });

  it('drops "none known" when the other record lists an allergy', () => {
    const merged = mergeMedicalItems(
      stored({ noKnownAllergies: true }),
      stored({ allergies: [PENICILLIN] }),
    );
    expect(merged).toMatchObject({ noKnownAllergies: false, allergyIds: ['penicillin'] });
  });

  it('keeps "none" where neither record lists anything, whichever record said it', () => {
    expect(mergeMedicalItems(stored(), stored({ noConditions: true }))).toMatchObject({
      noConditions: true,
      conditionIds: [],
    });
  });

  it('answers null when the kept record already holds the result', () => {
    expect(
      mergeMedicalItems(
        stored({ allergies: [PENICILLIN], noConditions: true }),
        stored({ allergies: [PENICILLIN] }),
      ),
    ).toBeNull();
    expect(mergeMedicalItems(stored(), stored())).toBeNull();
  });
});
