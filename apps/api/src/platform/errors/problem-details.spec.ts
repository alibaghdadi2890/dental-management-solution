import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError } from '../kernel/domain-error';
import { toProblemDetails } from './problem-details';

class VisitAlreadyCompleted extends DomainError {
  readonly code = 'visit.already_completed';
  readonly kind = 'conflict';
}

describe('toProblemDetails', () => {
  it('maps domain errors by kind and keeps their stable code', () => {
    expect(toProblemDetails(new VisitAlreadyCompleted('Visit v1 is completed'), 'req-1')).toEqual({
      type: 'urn:dcm:problem:visit.already_completed',
      title: 'Conflict',
      status: 409,
      code: 'visit.already_completed',
      detail: 'Visit v1 is completed',
      requestId: 'req-1',
    });
  });

  it('maps raw Zod errors to validation_failed with field paths', () => {
    const result = z.object({ patient: z.object({ name: z.string() }) }).safeParse({ patient: {} });
    const problem = toProblemDetails(result.error);

    expect(problem.status).toBe(400);
    expect(problem.code).toBe('validation_failed');
    expect(problem.errors).toEqual([
      expect.objectContaining({ path: 'patient.name', code: 'invalid_type' }),
    ]);
  });

  it('maps framework client errors to stable codes', () => {
    expect(toProblemDetails(new NotFoundException()).code).toBe('not_found');
    expect(toProblemDetails(new ForbiddenException()).status).toBe(403);
  });

  it('hides the details of server errors', () => {
    const problem = toProblemDetails(new Error('relation "patients" does not exist'));
    expect(problem).toEqual({
      type: 'urn:dcm:problem:internal_error',
      title: 'Internal server error',
      status: 500,
      code: 'internal_error',
    });
    expect(toProblemDetails(new ServiceUnavailableException('redis down')).code).toBe(
      'internal_error',
    );
  });
});
