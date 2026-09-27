import { describe, expect, it } from 'vitest';
import {
  MergeSameError,
  PatientArchivedError,
  PatientMergedError,
  PatientNotFoundError,
  UnknownDentistError,
} from './patient-errors';

/**
 * `DomainError.kind` is what `platform/errors/problem-details.ts` maps to an HTTP status
 * (`invalid` → 422, `not_found` → 404, `conflict` → 409 — see `STATUS_BY_KIND`, exercised
 * generically for any `DomainError` in `problem-details.spec.ts`). `domain/` may only import
 * `platform/kernel` (CLAUDE.md §4), so this test checks the `code`/`kind` pairs directly rather
 * than importing the mapper.
 */
describe('patient domain errors', () => {
  it.each([
    [new PatientNotFoundError('missing'), 'patient.not_found', 'not_found'],
    [new PatientArchivedError('archived'), 'patient.archived', 'conflict'],
    [new PatientMergedError('merged'), 'patient.merged', 'conflict'],
    [new MergeSameError('same'), 'patient.merge_same', 'invalid'],
    [new UnknownDentistError('unknown'), 'patient.unknown_dentist', 'invalid'],
  ])('%s carries code %s and kind %s', (error, code, kind) => {
    expect(error.code).toBe(code);
    expect(error.kind).toBe(kind);
  });
});
