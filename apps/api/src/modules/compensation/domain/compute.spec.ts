import type { AgreementComponent } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import type { AgreementRecord } from './agreements';
import type { ChargeLinesFact } from './blend';
import {
  type CollectionFact,
  computeMonth,
  computeMonths,
  type DentistData,
  type EntryFact,
  type MonthResult,
  type VisitFact,
} from './compute';

const agreement = (
  components: AgreementComponent[],
  over: Partial<AgreementRecord> = {},
): AgreementRecord => ({
  id: 'ag-1',
  profileId: 'A',
  preset: 'custom',
  components,
  effectiveFrom: '2026-10-01',
  effectiveTo: null,
  statementVisibleToDentist: true,
  superseded: false,
  ...over,
});

const share = (
  percent: string,
  basis: 'production' | 'collection',
  extra: Partial<Extract<AgreementComponent, { kind: 'share' }>> = {},
): AgreementComponent => ({
  kind: 'share',
  percent,
  basis,
  rateOverrides: [],
  threshold: null,
  ...extra,
});

let numbers = 0;
const visit = (id: string, localDate: string, over: Partial<VisitFact> = {}): VisitFact => ({
  visitId: id,
  displayNumber: ++numbers,
  dentistId: 'A',
  patientId: `p-${id}`,
  localDate,
  type: 'treatment',
  total: '100.00',
  voided: false,
  imported: false,
  ...over,
});

const entry = (
  visitId: string,
  amount: string,
  date: string,
  kind: EntryFact['kind'] = 'visit_charge',
  id = `e-${visitId}-${kind}-${date}`,
): EntryFact => ({ id, visitId, kind, amount, currency: 'USD', date });

const paid = (
  id: string,
  visitId: string,
  amount: string,
  date: string,
  kind: CollectionFact['kind'] = 'allocation',
): CollectionFact => ({ id, visitId, kind, amount, currency: 'USD', date });

function data(over: Partial<DentistData> & { visitList?: VisitFact[] }): DentistData {
  const { visitList = [], ...rest } = over;
  return {
    currency: 'USD',
    agreements: [],
    visits: new Map(visitList.map((fact) => [fact.visitId, fact])),
    entries: [],
    collections: [],
    chargeLines: new Map(),
    categories: new Map(),
    adjustments: [],
    payouts: [],
    ...rest,
  };
}

const amounts = (result: MonthResult, component: string) =>
  result.earned.find((group) => group.component === component)?.lines.map((line) => line.amount);

describe('computeMonth: shares', () => {
  const v1 = visit('v1', '2026-10-05', { total: '300.00' });
  const v2 = visit('v2', '2026-10-10', { total: '200.00' });
  const facts = {
    visitList: [v1, v2],
    entries: [entry('v1', '300.00', '2026-10-05'), entry('v2', '200.00', '2026-10-10')],
    collections: [
      paid('a1', 'v1', '300.00', '2026-10-05'),
      paid('a2', 'v2', '100.00', '2026-10-12'),
    ],
  };

  it('pays 40 % of collected amounts', () => {
    const result = computeMonth(
      data({ ...facts, agreements: [agreement([share('40', 'collection')])] }),
      '2026-10',
      0n,
      null,
    );
    expect(amounts(result, 'share')).toEqual(['120.00', '40.00']);
    expect(result.totals.earned).toBe('160.00');
    expect(result.totals.closing).toBe('160.00');
    expect(result.report).toMatchObject({ visits: 2, production: 50000n, collections: 40000n });
  });

  it('pays 40 % of billed amounts, and a checkout discount lowers the base on its own date', () => {
    const billed = data({ ...facts, agreements: [agreement([share('40', 'production')])] });
    expect(computeMonth(billed, '2026-10', 0n, null).totals.earned).toBe('200.00');
    const discounted = computeMonth(
      {
        ...billed,
        entries: [
          ...billed.entries,
          entry('v2', '-20.00', '2026-10-10', 'visit_charge_adjustment'),
        ],
      },
      '2026-10',
      0n,
      null,
    );
    expect(amounts(discounted, 'share')).toEqual(['120.00', '80.00', '-8.00']);
  });

  it('blends rates by service over the lines pro-rated to the net total', () => {
    const v3 = visit('v3', '2026-10-15', { total: '945.00' });
    const charge: ChargeLinesFact = {
      visitId: 'v3',
      net: '945.00',
      currency: 'USD',
      lines: [
        { code: 'IMP', amount: '1000.00' },
        { code: 'EXM', amount: '50.00' },
      ],
    };
    const result = computeMonth(
      data({
        visitList: [v3],
        agreements: [
          agreement([
            share('40', 'collection', {
              rateOverrides: [{ target: 'category', key: 'Implants', percent: '30' }],
            }),
          ]),
        ],
        collections: [paid('a3', 'v3', '500.00', '2026-10-15')],
        chargeLines: new Map([['v3', charge]]),
        categories: new Map([
          ['IMP', 'Implants'],
          ['EXM', 'Diagnostics'],
        ]),
      }),
      '2026-10',
      0n,
      null,
    );
    const [line] = result.earned[0]?.lines ?? [];
    expect(line?.amount).toBe('152.38');
    expect(line?.rate).toEqual({
      percent: '30.48',
      blended: true,
      lines: [
        { code: 'IMP', amount: '900.00', percent: '30.00' },
        { code: 'EXM', amount: '45.00', percent: '40.00' },
      ],
    });
  });

  it('takes a service code override over its category', () => {
    const v = visit('v', '2026-10-15');
    const result = computeMonth(
      data({
        visitList: [v],
        agreements: [
          agreement([
            share('40', 'production', {
              rateOverrides: [
                { target: 'category', key: 'Implants', percent: '30' },
                { target: 'service', key: 'IMP', percent: '50' },
              ],
            }),
          ]),
        ],
        entries: [entry('v', '100.00', '2026-10-15')],
        chargeLines: new Map([
          [
            'v',
            {
              visitId: 'v',
              net: '100.00',
              currency: 'USD',
              lines: [{ code: 'IMP', amount: '100.00' }],
            },
          ],
        ]),
        categories: new Map([['IMP', 'Implants']]),
      }),
      '2026-10',
      0n,
      null,
    );
    expect(amounts(result, 'share')).toEqual(['50.00']);
  });

  it('applies a threshold to the month: share of the base above it, one line for the difference', () => {
    const b1 = visit('b1', '2026-10-03');
    const b2 = visit('b2', '2026-10-20');
    const result = computeMonth(
      data({
        visitList: [b1, b2],
        agreements: [
          agreement([
            { kind: 'monthlyFixed', amount: '1000', prorate: true },
            share('20', 'production', { threshold: '3000' }),
          ]),
        ],
        entries: [entry('b1', '2500.00', '2026-10-03'), entry('b2', '1500.00', '2026-10-20')],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(amounts(result, 'monthlyFixed')).toEqual(['1000.00']);
    expect(amounts(result, 'share')).toEqual(['500.00', '300.00', '-600.00']);
    expect(result.totals.earned).toBe('1200.00');
  });

  it('earns nothing above zero when the base stays under the threshold', () => {
    const b1 = visit('b1', '2026-10-03');
    const result = computeMonth(
      data({
        visitList: [b1],
        agreements: [agreement([share('20', 'production', { threshold: '3000' })])],
        entries: [entry('b1', '2500.00', '2026-10-03')],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(result.totals.earned).toBe('0.00');
  });

  it('uses the agreement in force on the visit date when terms change mid-month', () => {
    const early = visit('early', '2026-10-10');
    const late = visit('late', '2026-10-20');
    const result = computeMonth(
      data({
        visitList: [early, late],
        agreements: [
          agreement([share('40', 'collection')], { id: 'a', effectiveTo: '2026-10-15' }),
          agreement([share('50', 'collection')], { id: 'b', effectiveFrom: '2026-10-16' }),
        ],
        collections: [
          paid('c1', 'early', '100.00', '2026-10-20'),
          paid('c2', 'late', '100.00', '2026-10-21'),
        ],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(amounts(result, 'share')).toEqual(['40.00', '50.00']);
  });

  it('ignores a superseded agreement', () => {
    const v = visit('v', '2026-10-05');
    const result = computeMonth(
      data({
        visitList: [v],
        agreements: [
          agreement([share('40', 'collection')], { id: 'old', superseded: true }),
          agreement([share('40', 'production')], { id: 'new' }),
        ],
        entries: [entry('v', '300.00', '2026-10-05')],
        collections: [paid('a', 'v', '300.00', '2026-10-05')],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(amounts(result, 'share')).toEqual(['120.00']);
    expect(result.earned[0]?.lines[0]?.source).toBe('visit_charge');
  });

  it('counts a release after a refund as a negative collection, rounded away from zero', () => {
    const v = visit('v', '2026-10-05');
    const result = computeMonth(
      data({
        visitList: [v],
        agreements: [agreement([share('50', 'collection')])],
        collections: [
          paid('a', 'v', '100.00', '2026-10-05'),
          paid('r', 'v', '-0.05', '2026-10-08', 'release'),
        ],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(amounts(result, 'share')).toEqual(['50.00', '-0.03']);
  });

  it('shows billed lines without an agreement at rate "—" and earns nothing from them', () => {
    const v = visit('v', '2026-09-28');
    const result = computeMonth(
      data({
        visitList: [v],
        agreements: [agreement([share('40', 'production')])],
        entries: [entry('v', '100.00', '2026-10-02', 'visit_charge_adjustment')],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(result.earned).toEqual([]);
    expect(result.noAgreement.map((line) => [line.base, line.rate, line.amount])).toEqual([
      ['100.00', null, '0.00'],
    ]);
  });

  it('lists lines in another currency without computing them', () => {
    const v = visit('v', '2026-10-05');
    const result = computeMonth(
      data({
        visitList: [v],
        agreements: [agreement([share('40', 'production')])],
        entries: [{ ...entry('v', '100.00', '2026-10-05'), currency: 'EUR' }],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(result.totals.earned).toBe('0.00');
    expect(result.notComputed.map((line) => [line.base, line.currency])).toEqual([
      ['100.00', 'EUR'],
    ]);
    expect(result.report.production).toBe(0n);
  });
});

describe('computeMonth: per visit, per day, fixed', () => {
  const perVisit: AgreementComponent = {
    kind: 'perVisit',
    amount: '15',
    byType: { consultation: '0' },
    chargedOnly: false,
  };
  const november = [
    visit('n1', '2026-11-03'),
    visit('n2', '2026-11-03', { type: 'consultation', total: '0.00' }),
    visit('n3', '2026-11-05'),
  ];
  const novemberAgreement = (component: AgreementComponent) =>
    agreement([component], { effectiveFrom: '2026-11-01' });

  it('pays per visit with an amount by type, and a void in an open month takes it out', () => {
    const result = computeMonth(
      data({ visitList: november, agreements: [novemberAgreement(perVisit)] }),
      '2026-11',
      0n,
      null,
    );
    expect(amounts(result, 'perVisit')).toEqual(['15.00', '0.00', '15.00']);
    expect(result.earned[0]?.lines.map((line) => line.unitAmount)).toEqual([
      '15.00',
      '0.00',
      '15.00',
    ]);
    expect(result.totals.earned).toBe('30.00');
    const voided = november.map((fact) =>
      fact.visitId === 'n3' ? { ...fact, voided: true } : fact,
    );
    expect(
      computeMonth(
        data({ visitList: voided, agreements: [novemberAgreement(perVisit)] }),
        '2026-11',
        0n,
        null,
      ).totals.earned,
    ).toBe('15.00');
  });

  it('pays per distinct day with a counted visit', () => {
    const result = computeMonth(
      data({
        visitList: november,
        agreements: [novemberAgreement({ kind: 'perDay', amount: '100' })],
      }),
      '2026-11',
      0n,
      null,
    );
    expect(amounts(result, 'perDay')).toEqual(['100.00', '100.00']);
    expect(result.earned[0]?.lines[0]?.count).toBe(2);
  });

  it('skips uncharged visits when charged only, and imported visits always', () => {
    const facts = [...november, visit('imp', '2026-11-07', { imported: true, total: null })];
    const result = computeMonth(
      data({
        visitList: facts,
        agreements: [novemberAgreement({ ...perVisit, chargedOnly: true })],
      }),
      '2026-11',
      0n,
      null,
    );
    expect(amounts(result, 'perVisit')).toEqual(['15.00', '15.00']);
    expect(result.report.visits).toBe(3);
  });

  it('pro-rates a monthly salary by the days it covers', () => {
    const result = computeMonth(
      data({
        agreements: [
          agreement([{ kind: 'monthlyFixed', amount: '1500', prorate: true }], {
            effectiveFrom: '2026-10-16',
          }),
        ],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(amounts(result, 'monthlyFixed')).toEqual(['774.19']);
    expect(result.earned[0]?.lines[0]?.count).toBe(16);
  });

  it('pays the whole amount when not pro-rated', () => {
    const result = computeMonth(
      data({
        agreements: [
          agreement([{ kind: 'monthlyFixed', amount: '1500', prorate: false }], {
            effectiveFrom: '2026-10-16',
          }),
        ],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(result.totals.earned).toBe('1500.00');
  });

  it('nets chair rent against a full share of collections: the dentist owes the clinic', () => {
    const v = visit('v', '2026-10-05');
    const result = computeMonth(
      data({
        visitList: [v],
        agreements: [
          agreement([
            { kind: 'monthlyFixed', amount: '-500', prorate: true },
            share('100', 'collection'),
          ]),
        ],
        collections: [paid('a', 'v', '300.00', '2026-10-05')],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(result.totals.earned).toBe('-200.00');
    expect(result.totals.closing).toBe('-200.00');
  });
});

describe('computeMonth: adjustments, payouts, late entries', () => {
  const billed = agreement([share('40', 'production')]);

  it('closes as opening + earned + late + adjustments − payouts, voided rows aside', () => {
    const v = visit('v', '2026-10-05');
    const result = computeMonth(
      data({
        visitList: [v],
        agreements: [billed],
        entries: [entry('v', '400.00', '2026-10-05')],
        adjustments: [
          { amount: '25.00', currency: 'USD', date: '2026-10-25', voided: false },
          { amount: '99.00', currency: 'USD', date: '2026-10-26', voided: true },
        ],
        payouts: [{ amount: '100.00', currency: 'USD', date: '2026-10-20', voided: false }],
      }),
      '2026-10',
      1000n,
      null,
    );
    expect(result.totals).toEqual({
      opening: '10.00',
      earned: '160.00',
      late: '0.00',
      adjustments: '25.00',
      payouts: '100.00',
      closing: '95.00',
    });
  });

  it('reports a line of a closed month it never counted as a late entry of the first open month', () => {
    const v2 = visit('v2', '2026-10-10');
    const v4 = visit('v4', '2026-10-31');
    const october = entry('v2', '200.00', '2026-10-10');
    const result = computeMonth(
      data({
        visitList: [v2, v4],
        agreements: [billed],
        entries: [october, entry('v4', '100.00', '2026-10-31')],
      }),
      '2026-11',
      6000n,
      { lastClosed: '2026-10', included: new Set([october.id]) },
    );
    expect(result.totals.opening).toBe('60.00');
    expect(result.earned).toEqual([]);
    expect(result.late).toEqual([expect.objectContaining({ month: '2026-10', total: '40.00' })]);
    expect(result.late[0]?.lines[0]).toMatchObject({
      date: '2026-10-31',
      visitId: 'v4',
      amount: '40.00',
    });
    expect(result.lineIds).toContain('e-v4-visit_charge-2026-10-31');
  });

  it('takes back a per-visit count of a closed month once the visit is voided, once', () => {
    const perVisit = agreement([
      { kind: 'perVisit', amount: '15', byType: {}, chargedOnly: false },
    ]);
    const voided = visit('x', '2026-10-10', { voided: true });
    const run = (included: string[]) =>
      computeMonth(data({ visitList: [voided], agreements: [perVisit] }), '2026-11', 0n, {
        lastClosed: '2026-10',
        included: new Set(included),
      });
    expect(
      run(['visit:x']).late[0]?.lines.map((line) => [line.id, line.amount, line.reversal]),
    ).toEqual([['visit:x:void', '-15.00', true]]);
    expect(run(['visit:x', 'visit:x:void']).late).toEqual([]);
    expect(run([]).late).toEqual([]);
  });

  it('pays a visit completed after its month closed, and its day, as late entries', () => {
    const late = visit('late', '2026-10-31');
    const result = computeMonth(
      data({
        visitList: [late],
        agreements: [
          agreement([
            { kind: 'perVisit', amount: '15', byType: {}, chargedOnly: false },
            { kind: 'perDay', amount: '100' },
          ]),
        ],
      }),
      '2026-11',
      0n,
      { lastClosed: '2026-10', included: new Set() },
    );
    expect(result.late[0]?.lines.map((line) => line.id).sort()).toEqual([
      'day:2026-10-31',
      'visit:late',
    ]);
    expect(result.totals.late).toBe('115.00');
  });

  it('takes back a counted day of a closed month that lost its last visit', () => {
    const result = computeMonth(
      data({
        visitList: [visit('x', '2026-10-10', { voided: true })],
        agreements: [agreement([{ kind: 'perDay', amount: '100' }])],
      }),
      '2026-11',
      0n,
      { lastClosed: '2026-10', included: new Set(['day:2026-10-10']) },
    );
    expect(result.totals.late).toBe('-100.00');
  });

  it('counts late lines in the threshold of the month that reports them', () => {
    const agreementWithThreshold = agreement([share('20', 'production', { threshold: '100' })]);
    const result = computeMonth(
      data({
        visitList: [visit('old', '2026-10-30'), visit('new', '2026-11-03')],
        agreements: [agreementWithThreshold],
        entries: [entry('old', '100.00', '2026-10-30'), entry('new', '100.00', '2026-11-03')],
      }),
      '2026-11',
      0n,
      { lastClosed: '2026-10', included: new Set() },
    );
    // base 200, threshold 100: the shares (20 + 20) keep half.
    expect(result.totals.earned).toBe('0.00');
    expect(result.totals.late).toBe('20.00');
  });
});

describe('computeMonth: review fixes', () => {
  it('lets a reversal through a threshold when the month base is negative', () => {
    const voided = visit('v', '2026-09-10');
    const result = computeMonth(
      data({
        visitList: [voided],
        agreements: [
          agreement([share('40', 'production', { threshold: '500' })], {
            effectiveFrom: '2026-09-01',
          }),
        ],
        entries: [entry('v', '-2000.00', '2026-10-03', 'visit_charge_reversal')],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(result.totals.earned).toBe('-800.00');
    expect(amounts(result, 'share')).toEqual(['-800.00']);
  });

  it('pays an unprorated fixed amount once when terms change in the month', () => {
    const fixed = (amount: string) => ({ kind: 'monthlyFixed' as const, amount, prorate: false });
    const result = computeMonth(
      data({
        agreements: [
          agreement([fixed('3000')], { id: 'old', effectiveTo: '2026-10-14' }),
          agreement([fixed('3500')], { id: 'new', effectiveFrom: '2026-10-15' }),
        ],
      }),
      '2026-10',
      0n,
      null,
    );
    expect(amounts(result, 'monthlyFixed')).toEqual(['3500.00']);
  });

  it('pays a day again when a visit counts on it after it was taken back', () => {
    const result = computeMonth(
      data({
        visitList: [visit('x', '2026-10-10', { voided: true }), visit('y', '2026-10-10')],
        agreements: [agreement([{ kind: 'perDay', amount: '100' }])],
      }),
      '2026-11',
      0n,
      { lastClosed: '2026-10', included: new Set(['day:2026-10-10', 'day:2026-10-10:void']) },
    );
    expect(result.late[0]?.lines.map((line) => [line.id, line.amount])).toEqual([
      ['day:2026-10-10:2', '100.00'],
    ]);
  });

  it('pays a visit again after a closed reversal, and takes it back again', () => {
    const perVisit = agreement([{ kind: 'perVisit', amount: '15', byType: {}, chargedOnly: true }]);
    const run = (total: string, included: string[]) =>
      computeMonth(
        data({ visitList: [visit('x', '2026-10-10', { total })], agreements: [perVisit] }),
        '2026-11',
        0n,
        { lastClosed: '2026-10', included: new Set(included) },
      ).late[0]?.lines.map((line) => [line.id, line.amount]);
    expect(run('50.00', ['visit:x', 'visit:x:void'])).toEqual([['visit:x:2', '15.00']]);
    expect(run('0.00', ['visit:x', 'visit:x:void', 'visit:x:2'])).toEqual([
      ['visit:x:2:void', '-15.00'],
    ]);
  });
});

describe('computeMonths', () => {
  it('chains each month from the previous closing; late entries go to the first month only', () => {
    const v = visit('v', '2026-10-05');
    const results = computeMonths(
      data({
        visitList: [v],
        agreements: [agreement([share('40', 'collection')])],
        collections: [
          paid('a1', 'v', '300.00', '2026-10-05'),
          paid('a2', 'v', '100.00', '2026-11-02'),
        ],
        payouts: [{ amount: '100.00', currency: 'USD', date: '2026-10-20', voided: false }],
      }),
      { from: '2026-10', to: '2026-11', opening: 0n, late: null },
    );
    expect(
      results.map((result) => [result.month, result.totals.opening, result.totals.closing]),
    ).toEqual([
      ['2026-10', '0.00', '20.00'],
      ['2026-11', '20.00', '60.00'],
    ]);
  });
});
