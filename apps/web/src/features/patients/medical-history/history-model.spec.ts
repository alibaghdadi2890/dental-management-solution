import {
  EMPTY_MEDICAL_HISTORY,
  type MedicalHistoryInput,
  type MedicalOption,
  toMedicalHistoryInput,
} from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addItem,
  isNone,
  pillsOf,
  removeItem,
  sameHistory,
  suggestionsOf,
  toggleNone,
} from './history-model';

const EMPTY: MedicalHistoryInput = toMedicalHistoryInput(EMPTY_MEDICAL_HISTORY);

const OPTIONS: MedicalOption[] = [
  { id: 'penicillin', kind: 'allergy', name: 'Penicillin', active: true },
  { id: 'latex', kind: 'allergy', name: 'Latex', active: true },
  { id: 'aspirin', kind: 'allergy', name: 'Aspirin', active: false },
  { id: 'asthma', kind: 'condition', name: 'Asthma', active: true },
];

describe('addItem and removeItem', () => {
  it('adds an item once, last, and removes it again', () => {
    const added = addItem(addItem(EMPTY, 'allergy', 'penicillin'), 'allergy', 'latex');
    expect(added.allergyIds).toEqual(['penicillin', 'latex']);
    expect(addItem(added, 'allergy', 'penicillin')).toBe(added);
    expect(removeItem(removeItem(added, 'allergy', 'latex'), 'allergy', 'penicillin')).toEqual(
      EMPTY,
    );
  });

  it('takes "none" back when an item is added, and leaves the other list alone', () => {
    const none = toggleNone(toggleNone(EMPTY, 'allergy'), 'condition');
    const added = addItem(none, 'allergy', 'latex');
    expect(isNone(added, 'allergy')).toBe(false);
    expect(isNone(added, 'condition')).toBe(true);
  });
});

describe('toggleNone', () => {
  it('clears the list, and a second click is "not asked" again', () => {
    const listed = addItem(EMPTY, 'condition', 'asthma');
    const none = toggleNone(listed, 'condition');
    expect(none).toMatchObject({ noConditions: true, conditionIds: [] });
    expect(toggleNone(none, 'condition')).toEqual(EMPTY);
  });
});

describe('pillsOf', () => {
  it('names what the patient has, in the order it was added', () => {
    const value = { ...EMPTY, allergyIds: ['penicillin', 'latex'], conditionIds: ['asthma'] };
    expect(pillsOf(value, 'allergy', OPTIONS, undefined).map((item) => item.name)).toEqual([
      'Penicillin',
      'Latex',
    ]);
  });

  it('names an item the clinic no longer lists from the saved history, and skips an unknown id', () => {
    const stored = { ...EMPTY_MEDICAL_HISTORY, allergies: [{ id: 'iodine', name: 'Iodine' }] };
    const value = { ...EMPTY, allergyIds: ['iodine', 'unknown'] };
    expect(pillsOf(value, 'allergy', OPTIONS, stored)).toEqual([{ id: 'iodine', name: 'Iodine' }]);
  });
});

describe('suggestionsOf', () => {
  const names = (text: string, value = EMPTY) =>
    suggestionsOf(value, 'allergy', OPTIONS, text).options.map((item) => item.name);

  it('offers the active options of the list by name, without what the patient has', () => {
    expect(names('')).toEqual(['Latex', 'Penicillin']);
    expect(names('', { ...EMPTY, allergyIds: ['latex'] })).toEqual(['Penicillin']);
  });

  it('matches anywhere in the name, whatever the case, a name starting with the text first', () => {
    expect(names('  LAT')).toEqual(['Latex']);
    expect(names('i')).toEqual(['Penicillin']);
    expect(names('e')).toEqual(['Latex', 'Penicillin']);
    expect(names('l')).toEqual(['Latex', 'Penicillin']);
  });

  it('offers to add a name the clinic does not offer: new, or marked inactive', () => {
    const create = (text: string) => suggestionsOf(EMPTY, 'allergy', OPTIONS, text).create;
    expect(create('')).toBeNull();
    expect(create('latex')).toBeNull();
    expect(create(' Kiwi ')).toBe('Kiwi');
    expect(create('Lat')).toBe('Lat');
    expect(create('aspirin')).toBe('aspirin');
    // A name of the other list is new to this one.
    expect(create('Asthma')).toBe('Asthma');
  });
});

describe('sameHistory', () => {
  it('ignores the order of the items and blank medication', () => {
    const a = { ...EMPTY, allergyIds: ['latex', 'penicillin'], medication: null };
    const b = { ...EMPTY, allergyIds: ['penicillin', 'latex'], medication: '  ' };
    expect(sameHistory(a, b)).toBe(true);
  });

  it('sees a flag, an item or the medication line change', () => {
    expect(sameHistory(EMPTY, toggleNone(EMPTY, 'allergy'))).toBe(false);
    expect(sameHistory(EMPTY, addItem(EMPTY, 'condition', 'asthma'))).toBe(false);
    expect(sameHistory(EMPTY, { ...EMPTY, medication: 'Warfarin' })).toBe(false);
  });
});
