import { describe, expect, it } from 'vitest';
import {
  type AdjustDraft,
  adjustRequest,
  adjustStatus,
  fullAmount,
  initialAdjustDraft,
} from './adjust-draft';

const TODAY = '2026-10-06';
const draft = (patch: Partial<AdjustDraft> = {}): AdjustDraft => ({
  ...initialAdjustDraft(TODAY),
  ...patch,
});
const status = (patch: Partial<AdjustDraft>, balance = 12000n) =>
  adjustStatus(draft(patch), balance, 'en', TODAY);

describe('adjust-balance draft (H4)', () => {
  it('starts as "owes less", dated today, with nothing to save', () => {
    expect(initialAdjustDraft(TODAY)).toEqual({
      direction: 'less',
      amountText: '',
      reason: '',
      note: '',
      effectiveDate: TODAY,
    });
    expect(status({})).toMatchObject({ amount: null, problem: null, after: null, ready: false });
  });

  it('shows the balance after in the chosen direction', () => {
    expect(status({ amountText: '20', reason: 'courtesy' })).toMatchObject({
      amount: 2000n,
      after: 10000n,
      ready: true,
    });
    expect(
      status({ direction: 'more', amountText: '35.50', reason: 'charge_without_visit' }),
    ).toMatchObject({ amount: 3550n, after: 15550n, ready: true });
    // Owing less than nothing leaves a credit.
    expect(status({ amountText: '150', reason: 'write_off' }).after).toBe(-3000n);
  });

  it('refuses an unreadable or zero amount, a missing reason and a date after today', () => {
    expect(status({ amountText: 'abc', reason: 'courtesy' })).toMatchObject({
      problem: 'invalid',
      ready: false,
    });
    expect(status({ amountText: '0', reason: 'courtesy' })).toMatchObject({
      problem: 'zero',
      ready: false,
    });
    expect(status({ amountText: '20' }).ready).toBe(false);
    expect(
      status({ amountText: '20', reason: 'courtesy', effectiveDate: '2026-10-07' }).ready,
    ).toBe(false);
    expect(status({ amountText: '20', reason: 'courtesy', effectiveDate: '' }).ready).toBe(false);
  });

  it('makes the note required for "Other" only', () => {
    expect(status({ amountText: '20', reason: 'other' })).toMatchObject({
      noteMissing: true,
      ready: false,
    });
    expect(status({ amountText: '20', reason: 'other', note: ' no ' }).ready).toBe(false);
    expect(status({ amountText: '20', reason: 'other', note: 'Lab remake' }).ready).toBe(true);
    expect(status({ amountText: '20', reason: 'write_off', note: '' }).ready).toBe(true);
  });

  it('fills the whole outstanding with Full, and nothing when nothing is owed', () => {
    expect(fullAmount(12000n)).toBe(12000n);
    expect(fullAmount(0n)).toBe(0n);
    expect(fullAmount(-500n)).toBe(0n);
  });

  it('signs the request by direction and leaves an empty note out', () => {
    expect(adjustRequest(draft({ reason: 'courtesy', note: '  ' }), 2000n)).toEqual({
      amount: '-20.00',
      effectiveDate: TODAY,
      reason: 'courtesy',
    });
    expect(
      adjustRequest(
        draft({
          direction: 'more',
          reason: 'other',
          note: ' Lab fee ',
          effectiveDate: '2026-07-08',
        }),
        3550n,
      ),
    ).toEqual({ amount: '35.50', effectiveDate: '2026-07-08', reason: 'other', note: 'Lab fee' });
    expect(adjustRequest(draft(), 100n)).toBeNull();
  });
});
