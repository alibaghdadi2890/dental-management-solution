import type { MedicalOption } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addRow,
  applyOption,
  batchOf,
  changedRows,
  draftFrom,
  dropRow,
  duplicateKeys,
  editRow,
  missingCount,
  rowsOf,
} from './option-lists-draft';

const ASTHMA: MedicalOption = { id: 'asthma', kind: 'condition', name: 'Asthma', active: true };
const OPTIONS: MedicalOption[] = [
  { id: 'latex', kind: 'allergy', name: 'Latex', active: true },
  { id: 'penicillin', kind: 'allergy', name: 'Penicillin', active: true },
  ASTHMA,
];

describe('the medical-history lists draft', () => {
  it('starts unchanged, one list per kind', () => {
    const draft = draftFrom(OPTIONS);
    expect(changedRows(draft)).toEqual([]);
    expect(rowsOf(draft, 'allergy').map((row) => row.name)).toEqual(['Latex', 'Penicillin']);
    expect(rowsOf(draft, 'condition')).toHaveLength(1);
  });

  it('sends only the new, renamed and switched rows, trimmed', () => {
    let draft = addRow(draftFrom(OPTIONS), 'allergy', 'new-1');
    draft = editRow(draft, 'new-1', { name: ' Sulfa ' });
    draft = editRow(draft, 'asthma', { active: false });
    draft = editRow(draft, 'latex', { name: 'Latex ' });
    expect(batchOf(changedRows(draft))).toEqual({
      items: [
        { id: 'asthma', kind: 'condition', name: 'Asthma', active: false },
        { kind: 'allergy', name: 'Sulfa', active: true },
      ],
    });
  });

  it('blocks on an unnamed row and on a name twice in one list, whatever its case', () => {
    let draft = addRow(draftFrom(OPTIONS), 'allergy', 'new-1');
    expect(missingCount(draft)).toBe(1);
    draft = editRow(draft, 'new-1', { name: 'latex' });
    expect(missingCount(draft)).toBe(0);
    expect([...duplicateKeys(draft)].sort()).toEqual(['latex', 'new-1']);
    // The same name in the other list is fine.
    const other = editRow(addRow(draftFrom(OPTIONS), 'condition', 'new-2'), 'new-2', {
      name: 'Latex',
    });
    expect(duplicateKeys(other).size).toBe(0);
  });

  it('drops a row, and takes a row the server changed as saved', () => {
    const draft = dropRow(draftFrom(OPTIONS), 'latex');
    expect(rowsOf(draft, 'allergy').map((row) => row.name)).toEqual(['Penicillin']);
    const off = applyOption(draftFrom(OPTIONS), { ...ASTHMA, active: false });
    expect(rowsOf(off, 'condition')[0]?.active).toBe(false);
    expect(changedRows(off)).toEqual([]);
  });
});
