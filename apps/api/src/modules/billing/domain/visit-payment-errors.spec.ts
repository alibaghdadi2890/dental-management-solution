import { describe, expect, it } from 'vitest';
import { VisitHasPaymentsError } from './visit-payment-errors';

describe('VisitHasPaymentsError', () => {
  it('is a 409 with a stable code', () => {
    const error = new VisitHasPaymentsError('x');
    expect(error.code).toBe('visit.has_payments');
    expect(error.kind).toBe('conflict');
  });
});
