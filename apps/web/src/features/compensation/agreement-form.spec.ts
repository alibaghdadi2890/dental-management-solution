import type { Agreement } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { draftOf, draftProblems, draftRequest, presetDraft } from './agreement-form';

const FROM = '2026-10-01';

describe('agreement form', () => {
  it('pre-fills a preset: revenue share on collected amounts by default (C4)', () => {
    const draft = presetDraft('revenueShare', FROM);
    expect(draft.on).toEqual({ monthlyFixed: false, share: true, perVisit: false, perDay: false });
    expect(draft.share.basis).toBe('collection');
    expect(draftProblems(draft, 'en')).toEqual({ 'share.percent': 'required' });
  });

  it('pre-fills chair rent as a charge with a full share of collections', () => {
    const draft = presetDraft('chairRent', FROM);
    draft.fixed.amount = '500';
    expect(draftRequest(draft, 'en')?.components).toEqual([
      { kind: 'monthlyFixed', amount: '-500', prorate: true },
      { kind: 'share', percent: '100', basis: 'collection', rateOverrides: [], threshold: null },
    ]);
  });

  it('starts Custom with nothing and refuses to save without a component', () => {
    const draft = presetDraft('custom', FROM);
    expect(draftProblems(draft, 'en')).toEqual({ components: 'none' });
    expect(draftRequest(draft, 'en')).toBeNull();
  });

  it('checks percents, amounts and rates by service', () => {
    const draft = presetDraft('salaryCommission', FROM);
    draft.fixed.amount = '1000';
    draft.share = {
      percent: '120',
      basis: 'production',
      overrides: [{ target: 'category', key: 'Implants', percent: 'x' }],
      threshold: 'lots',
    };
    expect(draftProblems(draft, 'en')).toEqual({
      'share.percent': 'percent',
      'share.overrides': 'percent',
      'share.threshold': 'amount',
    });
    draft.share = { ...draft.share, percent: '20', overrides: [], threshold: '3000' };
    expect(draftRequest(draft, 'en')?.components[1]).toMatchObject({ threshold: '3000' });
  });

  it('keeps only the amounts by visit type that are filled', () => {
    const draft = presetDraft('perVisit', FROM);
    draft.perVisit.amount = '15';
    draft.perVisit.byType = { consultation: '0', hygiene: ' ' };
    expect(draftRequest(draft, 'en')?.components).toEqual([
      { kind: 'perVisit', amount: '15', byType: { consultation: '0' }, chargedOnly: false },
    ]);
  });

  it('reads an agreement back into a draft for a change of terms', () => {
    const agreement = {
      preset: 'chairRent',
      components: [
        { kind: 'monthlyFixed', amount: '-500.00', prorate: false },
        { kind: 'share', percent: '100', basis: 'collection', rateOverrides: [], threshold: null },
      ],
      statementVisibleToDentist: false,
      note: 'Room 2',
    } as unknown as Agreement;
    const draft = draftOf(agreement, '2026-11-01');
    expect(draft.fixed).toEqual({ amount: '500.00', direction: 'charge', prorate: false });
    expect(draft.visible).toBe(false);
    expect(draftRequest(draft, 'en')).toMatchObject({
      effectiveFrom: '2026-11-01',
      note: 'Room 2',
    });
  });

  it('reads amounts as typed in the UI language', () => {
    const draft = presetDraft('perDay', FROM);
    draft.perDay.amount = '12,50';
    expect(draftRequest(draft, 'fr')?.components).toEqual([{ kind: 'perDay', amount: '12.50' }]);
  });
});
