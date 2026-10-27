import { describe, expect, it } from 'vitest';
import {
  type AgreementRecord,
  assertCreatable,
  assertDateOpen,
  assertEndable,
  planDeactivation,
  planTermsChange,
  statusOf,
} from './agreements';
import { applyRate, prorate, rateOfPercent, ratePercent, roundDiv } from './money';
import { assertClosable, assertReopenable, firstMonthOf } from './periods';

const agreement = (over: Partial<AgreementRecord> = {}): AgreementRecord => ({
  id: 'a',
  profileId: 'A',
  preset: 'revenueShare',
  components: [
    { kind: 'share', percent: '40', basis: 'collection', rateOverrides: [], threshold: null },
  ],
  effectiveFrom: '2026-10-01',
  effectiveTo: null,
  statementVisibleToDentist: true,
  superseded: false,
  ...over,
});

const code = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
};

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
    expect(applyRate(50000n, rateOfPercent('40'))).toBe(20000n);
  });

  it('pro-rates to an exact total', () => {
    expect(prorate([100000n, 5000n], 94500n)).toEqual([90000n, 4500n]);
    expect(prorate([1n, 1n, 1n], 100n)).toEqual([34n, 33n, 33n]);
    expect(prorate([1n, 1n], -3n)).toEqual([-2n, -1n]);
    expect(prorate([0n, 0n], 10n)).toEqual([10n, 0n]);
  });

  it('shows a rate with two decimals', () => {
    expect(ratePercent({ num: 28800n * 10000n, den: 94500n * 10000n })).toBe('30.48');
    expect(ratePercent(rateOfPercent('30.48'))).toBe('30.48');
  });
});

describe('agreements', () => {
  it('tells its status on a day', () => {
    expect(statusOf(agreement(), '2026-10-25')).toBe('active');
    expect(statusOf(agreement({ effectiveFrom: '2026-11-01' }), '2026-10-25')).toBe('future');
    expect(statusOf(agreement({ effectiveTo: '2026-10-24' }), '2026-10-25')).toBe('ended');
    expect(statusOf(agreement({ superseded: true }), '2026-10-25')).toBe('superseded');
  });

  it('refuses dates in a closed month', () => {
    expect(
      code(() => {
        assertDateOpen('2026-10-31', '2026-10');
      }),
    ).toBe('compensation.period_closed');
    expect(
      code(() => {
        assertDateOpen('2026-09-01', '2026-10');
      }),
    ).toBe('compensation.period_closed');
    expect(
      code(() => {
        assertDateOpen('2026-11-01', '2026-10');
      }),
    ).toBeNull();
    expect(
      code(() => {
        assertCreatable({ effectiveFrom: '2026-10-05', effectiveTo: '2026-10-01' }, null);
      }),
    ).toBe('compensation.effective_date');
  });

  it('only ever shortens an agreement, never before its start', () => {
    const ended = agreement({ effectiveTo: '2026-12-31' });
    expect(
      code(() => {
        assertEndable(ended, '2026-11-30', null);
      }),
    ).toBeNull();
    expect(
      code(() => {
        assertEndable(ended, '2026-12-31', null);
      }),
    ).toBe('compensation.effective_date');
    expect(
      code(() => {
        assertEndable(agreement(), '2026-09-30', null);
      }),
    ).toBe('compensation.effective_date');
    expect(
      code(() => {
        assertEndable(agreement({ superseded: true }), '2026-11-30', null);
      }),
    ).toBe('compensation.not_reversible');
    expect(
      code(() => {
        assertEndable(agreement(), '2026-10-31', '2026-10');
      }),
    ).toBeNull();
    expect(
      code(() => {
        assertEndable(agreement(), '2026-10-30', '2026-10');
      }),
    ).toBe('compensation.period_closed');
  });

  it('changes terms by starting, superseding on the first day, or ending the day before', () => {
    const current = agreement();
    expect(planTermsChange([], '2026-10-01', null)).toEqual({ kind: 'start' });
    expect(planTermsChange([current], '2026-10-01', null)).toEqual({ kind: 'supersede', current });
    expect(planTermsChange([current], '2026-11-01', null)).toEqual({
      kind: 'end',
      current,
      endOn: '2026-10-31',
    });
    expect(code(() => planTermsChange([current], '2026-10-01', '2026-10'))).toBe(
      'compensation.period_closed',
    );
  });

  it('ends the agreement in force and supersedes later ones on deactivation', () => {
    const now = agreement({ id: 'now', effectiveTo: '2026-11-30' });
    const later = agreement({ id: 'later', effectiveFrom: '2026-12-01' });
    const past = agreement({ id: 'past', effectiveFrom: '2026-01-01', effectiveTo: '2026-09-30' });
    const plan = planDeactivation([now, later, past], '2026-11-15');
    expect(plan.end.map((row) => row.id)).toEqual(['now']);
    expect(plan.supersede.map((row) => row.id)).toEqual(['later']);
  });
});

describe('periods', () => {
  const base = { today: '2026-11-01', firstMonth: '2026-09', lastClosed: null as string | null };

  it('closes the first month, then in order, once the month has ended', () => {
    expect(
      code(() => {
        assertClosable({ ...base, month: '2026-09' });
      }),
    ).toBeNull();
    expect(
      code(() => {
        assertClosable({ ...base, month: '2026-10' });
      }),
    ).toBe('compensation.previous_period_open');
    expect(
      code(() => {
        assertClosable({ ...base, month: '2026-10', lastClosed: '2026-09' });
      }),
    ).toBeNull();
    expect(
      code(() => {
        assertClosable({ ...base, month: '2026-11', lastClosed: '2026-10' });
      }),
    ).toBe('compensation.month_not_ended');
    expect(
      code(() => {
        assertClosable({ ...base, month: '2026-09', lastClosed: '2026-09' });
      }),
    ).toBe('compensation.already_closed');
    expect(
      code(() => {
        assertClosable({ ...base, month: '2026-08' });
      }),
    ).toBe('compensation.not_found');
  });

  it('reopens only the last closed month', () => {
    expect(
      code(() => {
        assertReopenable('2026-10', '2026-10');
      }),
    ).toBeNull();
    expect(
      code(() => {
        assertReopenable('2026-09', '2026-10');
      }),
    ).toBe('compensation.next_period_closed');
    expect(
      code(() => {
        assertReopenable('2026-11', '2026-10');
      }),
    ).toBe('compensation.not_closed');
  });

  it('finds the first month from the earliest date', () => {
    expect(firstMonthOf(['2026-10-16', '2026-09-30'])).toBe('2026-09');
    expect(firstMonthOf([])).toBeNull();
  });
});
