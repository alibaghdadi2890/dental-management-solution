import { describe, expect, it } from 'vitest';
import { paymentInputSchema } from './payments.js';

const ID_A = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_B = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

const base = { patientId: ID_A, amount: '500.00', method: 'cash', paidAt: '2026-01-01' };

const advanceIssue = (input: Record<string, unknown>) => {
  const result = paymentInputSchema.safeParse(input);
  return result.success ? null : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('paymentInputSchema advance (ADR-0051 A9)', () => {
  it('accepts both kinds for this patient', () => {
    expect(advanceIssue({ ...base, advance: 'plan' })).toBeNull();
    expect(advanceIssue({ ...base, advance: 'credit' })).toBeNull();
  });

  it('refuses a household advance or one aimed at a specific charge', () => {
    expect(advanceIssue({ ...base, advance: 'credit', scope: 'household' })).toEqual(['advance']);
    expect(advanceIssue({ ...base, advance: 'plan', targetEntryId: ID_B })).toEqual(['advance']);
  });

  it('lets a credit advance, but not a plan advance, be opened from a visit', () => {
    expect(advanceIssue({ ...base, advance: 'credit', contextVisitId: ID_B })).toBeNull();
    expect(advanceIssue({ ...base, advance: 'plan', contextVisitId: ID_B })).toEqual(['advance']);
  });

  it('leaves an ordinary payment as it was', () => {
    expect(advanceIssue({ ...base, scope: 'household', targetEntryId: ID_B })).toBeNull();
  });
});
