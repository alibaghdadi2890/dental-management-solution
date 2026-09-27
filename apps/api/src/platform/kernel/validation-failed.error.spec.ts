import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from './validation-failed.error';

describe('ValidationFailedError', () => {
  it('is an invalid-kind domain error that carries row-level issues', () => {
    const issue = { path: 'items.1.code', code: 'duplicate', message: 'Code EXT is already used' };
    const error = new ValidationFailedError('1 row is invalid', [issue]);

    expect(error.code).toBe('validation_failed');
    expect(error.kind).toBe('invalid');
    expect(error.issues).toEqual([issue]);
  });
});
