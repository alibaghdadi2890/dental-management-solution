import { describe, expect, it } from 'vitest';
import { isDiscardable, type DiscardFacts } from './discard-rule';

const empty: DiscardFacts = {
  services: 0,
  diagnosesRecorded: 0,
  diagnosesResolved: 0,
  plansRecorded: 0,
  plansPerformed: 0,
  plansCancelled: 0,
  planSessions: 0,
  toothChanges: 0,
  notes: '',
};

describe('isDiscardable', () => {
  it('allows discarding an empty visit', () => {
    expect(isDiscardable(empty)).toBe(true);
  });

  it.each<keyof Omit<DiscardFacts, 'notes'>>([
    'services',
    'diagnosesRecorded',
    'diagnosesResolved',
    'plansRecorded',
    'plansPerformed',
    'plansCancelled',
    'planSessions',
    'toothChanges',
  ])('refuses when %s alone is non-zero', (fact) => {
    expect(isDiscardable({ ...empty, [fact]: 1 })).toBe(false);
  });

  it('refuses when the visit has notes', () => {
    expect(isDiscardable({ ...empty, notes: 'Sensitive to cold' })).toBe(false);
  });

  it('treats whitespace-only notes as empty', () => {
    expect(isDiscardable({ ...empty, notes: ' \n\t ' })).toBe(true);
  });

  it('is not blocked by a discount alone (the facts carry none)', () => {
    const withDiscount = { ...empty, discountMode: 'amount', discountValue: '25.00' };
    expect(isDiscardable(withDiscount)).toBe(true);
  });
});
