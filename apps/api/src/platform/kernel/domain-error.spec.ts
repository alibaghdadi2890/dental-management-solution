import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';

class VisitAlreadyCompleted extends DomainError {
  readonly code = 'visit.already_completed';
  readonly kind = 'conflict';
}

describe('DomainError', () => {
  it('carries a stable code, a kind and optional details', () => {
    const error = new VisitAlreadyCompleted('Visit is already completed', { visitId: 'v1' });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('visit.already_completed');
    expect(error.kind).toBe('conflict');
    expect(error.details).toEqual({ visitId: 'v1' });
    expect(error.name).toBe('VisitAlreadyCompleted');
    expect(error.message).toBe('Visit is already completed');
  });
});
