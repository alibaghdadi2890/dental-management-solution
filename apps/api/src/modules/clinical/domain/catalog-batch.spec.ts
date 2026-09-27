import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { assertUniqueCodes, type CodedRow } from './catalog-batch';

const stored: CodedRow[] = [
  { id: 'a', code: 'EXT', name: 'Extraction' },
  { id: 'b', code: 'CMP', name: 'Composite' },
  { id: 'c', code: 'ZIR', name: 'Zircon crown' },
];

function issuesOf(changes: CodedRow[], existing: CodedRow[] = stored) {
  try {
    assertUniqueCodes(existing, changes);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationFailedError);
    return (error as ValidationFailedError).issues;
  }
}

describe('assertUniqueCodes', () => {
  it('accepts new codes and unchanged codes', () => {
    expect(
      issuesOf([
        { id: 'n1', code: 'IMPL', name: 'Implant' },
        { ...stored[0]!, name: 'Ext.' },
      ]),
    ).toEqual([]);
  });

  it('reports a changed row whose code another stored row holds, at its batch index', () => {
    expect(
      issuesOf([
        { id: 'n1', code: 'IMPL', name: 'Implant' },
        { id: 'n2', code: 'ext', name: 'Simple extraction' },
      ]),
    ).toEqual([
      {
        path: 'items.1.code',
        code: 'duplicate',
        message: 'Code EXT is already used by "Extraction"',
      },
    ]);
  });

  it('reports both rows of a batch that share a code', () => {
    expect(
      issuesOf([
        { id: 'n1', code: 'IMPL', name: 'Implant' },
        { id: 'n2', code: 'Impl', name: 'Implant consult' },
      ]).map((issue) => [issue.path, issue.message]),
    ).toEqual([
      ['items.0.code', 'Code IMPL is already used by "Implant consult"'],
      ['items.1.code', 'Code IMPL is already used by "Implant"'],
    ]);
  });

  it('checks the state after the batch, so rows may swap codes', () => {
    expect(
      issuesOf([
        { ...stored[0]!, code: 'CMP' },
        { ...stored[1]!, code: 'EXT' },
      ]),
    ).toEqual([]);
  });

  it('frees the code of a row the batch renames', () => {
    expect(
      issuesOf([
        { ...stored[0]!, code: 'EXT-1' },
        { id: 'n1', code: 'EXT', name: 'Extraction (new)' },
      ]),
    ).toEqual([]);
  });

  it('says how many rows failed', () => {
    expect(() => {
      assertUniqueCodes(stored, [
        { id: 'n1', code: 'EXT', name: 'x' },
        { id: 'n2', code: 'CMP', name: 'y' },
      ]);
    }).toThrow('2 rows have a duplicate code');
  });
});
