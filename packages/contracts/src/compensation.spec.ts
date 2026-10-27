import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_PRESETS,
  agreementComponentsSchema,
  canReadStatement,
  createAgreementSchema,
  monthSchema,
  PRESET_COMPONENTS,
  recordAdjustmentSchema,
  recordPayoutSchema,
} from './compensation.js';

const share = { kind: 'share', percent: '40' };

describe('agreement components', () => {
  it('fills the defaults of a share: collected, no overrides, no threshold', () => {
    expect(agreementComponentsSchema.parse([share])).toEqual([
      { kind: 'share', percent: '40', basis: 'collection', rateOverrides: [], threshold: null },
    ]);
  });

  it('needs at least one component and at most one of each kind', () => {
    expect(agreementComponentsSchema.safeParse([]).success).toBe(false);
    expect(agreementComponentsSchema.safeParse([share, share]).success).toBe(false);
  });

  it('keeps percents within 0–100 with two decimals', () => {
    for (const percent of ['0', '30.48', '100']) {
      expect(agreementComponentsSchema.safeParse([{ ...share, percent }]).success).toBe(true);
    }
    for (const percent of ['100.01', '-1', '30.485', 'abc']) {
      expect(agreementComponentsSchema.safeParse([{ ...share, percent }]).success).toBe(false);
    }
  });

  it('allows one rate per service or category', () => {
    const override = { target: 'service', key: 'IMP', percent: '30' };
    expect(
      agreementComponentsSchema.safeParse([
        { ...share, rateOverrides: [override, { ...override, target: 'category' }] },
      ]).success,
    ).toBe(true);
    expect(
      agreementComponentsSchema.safeParse([{ ...share, rateOverrides: [override, override] }])
        .success,
    ).toBe(false);
  });

  it('takes a signed fixed amount but never zero, and per visit amounts of 0 by type', () => {
    const rent = { kind: 'monthlyFixed', amount: '-500' };
    expect(agreementComponentsSchema.parse([rent])).toEqual([{ ...rent, prorate: true }]);
    expect(agreementComponentsSchema.safeParse([{ ...rent, amount: '0' }]).success).toBe(false);
    const perVisit = { kind: 'perVisit', amount: '15', byType: { consultation: '0' } };
    expect(agreementComponentsSchema.safeParse([perVisit]).success).toBe(true);
    expect(
      agreementComponentsSchema.safeParse([{ ...perVisit, byType: { consultation: '-1' } }])
        .success,
    ).toBe(false);
    expect(agreementComponentsSchema.safeParse([{ kind: 'perDay', amount: '0' }]).success).toBe(
      false,
    );
  });

  it('gives every preset but Custom a component set', () => {
    for (const preset of AGREEMENT_PRESETS) {
      expect(PRESET_COMPONENTS[preset].length > 0).toBe(preset !== 'custom');
    }
  });
});

describe('agreement and money inputs', () => {
  it('refuses an agreement that ends before it starts', () => {
    const input = { preset: 'revenueShare', components: [share], effectiveFrom: '2026-10-01' };
    expect(createAgreementSchema.parse(input).effectiveTo).toBeNull();
    expect(createAgreementSchema.safeParse({ ...input, effectiveTo: '2026-09-30' }).success).toBe(
      false,
    );
  });

  it('needs a note for an Other adjustment and refuses zero', () => {
    const input = { kind: 'other', amount: '-20', date: '2026-10-25' };
    expect(recordAdjustmentSchema.safeParse(input).success).toBe(false);
    expect(recordAdjustmentSchema.safeParse({ ...input, note: 'Parking' }).success).toBe(true);
    expect(recordAdjustmentSchema.safeParse({ ...input, kind: 'bonus', amount: '0' }).success).toBe(
      false,
    );
  });

  it('takes a positive payout only', () => {
    const input = { amount: '100', date: '2026-10-20', method: 'cash' };
    expect(recordPayoutSchema.safeParse(input).success).toBe(true);
    expect(recordPayoutSchema.safeParse({ ...input, amount: '-100' }).success).toBe(false);
  });

  it('reads months as YYYY-MM', () => {
    expect(monthSchema.safeParse('2026-10').success).toBe(true);
    expect(monthSchema.safeParse('2026-13').success).toBe(false);
  });
});

describe('canReadStatement', () => {
  it('reads every statement with compensation:manage', () => {
    expect(
      canReadStatement({ permissions: ['compensation:manage'], profileId: null }, 'profile-b'),
    ).toBe(true);
  });

  it('reads only its own with compensation:read', () => {
    const actor = { permissions: ['compensation:read' as const], profileId: 'profile-a' };
    expect(canReadStatement(actor, 'profile-a')).toBe(true);
    expect(canReadStatement(actor, 'profile-b')).toBe(false);
    expect(
      canReadStatement({ permissions: ['compensation:read'], profileId: null }, 'profile-a'),
    ).toBe(false);
  });

  it('reads nothing without a compensation permission', () => {
    expect(
      canReadStatement({ permissions: ['finance:read'], profileId: 'profile-a' }, 'profile-a'),
    ).toBe(false);
  });
});
