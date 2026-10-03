import { describe, expect, it } from 'vitest';
import {
  type AllocationPair,
  type AllocationSource,
  type AllocationTarget,
  outstandingByTarget,
  planPayment,
  refundReleases,
  settle,
  unallocatedBySource,
} from './allocate';

const $ = (dollars: number) => BigInt(Math.round(dollars * 100));

const target = (entryId: string, date: string, net: number, createdAt = 0): AllocationTarget => ({
  entryId,
  date,
  createdAt,
  net: $(net),
});
const source = (
  entryId: string,
  date: string,
  capacity: number,
  createdAt = 0,
): AllocationSource => ({
  entryId,
  date,
  createdAt,
  capacity: $(capacity),
});
const pair = (sourceId: string, targetId: string, amount: number, order = 0): AllocationPair => ({
  sourceId,
  targetId,
  amount: $(amount),
  order,
});

/** The acceptance account: opening balance $200, then visits of $300, $400 and $100. */
const account = [
  target('ob', '2026-01-05', 200),
  target('v1', '2026-02-01', 300),
  target('v2', '2026-03-01', 400),
  target('v3', '2026-04-01', 100),
];

const plan = (input: Parameters<typeof planPayment>[0]) => {
  const result = planPayment(input);
  return {
    unallocated: result.unallocated,
    lines: result.allocations.map((line) => [line.targetId, line.amount, line.manual]),
  };
};

describe('planPayment (B2, B4)', () => {
  it('covers the oldest charges first, the opening balance counting as the oldest', () => {
    expect(plan({ amount: $(500), targets: account, pairs: [] })).toEqual({
      unallocated: 0n,
      lines: [
        ['ob', $(200), false],
        ['v1', $(300), false],
      ],
    });
  });

  it('stops part-way through a charge on a partial payment', () => {
    expect(plan({ amount: $(150), targets: account, pairs: [] }).lines).toEqual([
      ['ob', $(150), false],
    ]);
  });

  it('pays everything on an exact payment and reports what is over', () => {
    expect(plan({ amount: $(1000), targets: account, pairs: [] }).unallocated).toBe(0n);
    expect(plan({ amount: $(1100), targets: account, pairs: [] }).unallocated).toBe($(100));
  });

  it('puts the context visit first, then the oldest', () => {
    expect(
      plan({ amount: $(650), targets: account, pairs: [], contextTargetId: 'v3' }).lines,
    ).toEqual([
      ['v3', $(100), false],
      ['ob', $(200), false],
      ['v1', $(300), false],
      ['v2', $(50), false],
    ]);
  });

  it('caps a manual target at its outstanding and lets the rest follow the order', () => {
    expect(
      plan({ amount: $(500), targets: account, pairs: [], manualTargetId: 'v2' }).lines,
    ).toEqual([
      ['v2', $(400), true],
      ['ob', $(100), false],
    ]);
  });

  it('takes the manual target before the context visit', () => {
    expect(
      plan({
        amount: $(150),
        targets: account,
        pairs: [],
        manualTargetId: 'v2',
        contextTargetId: 'v3',
      }).lines,
    ).toEqual([['v2', $(150), true]]);
  });

  it('only takes what is still owed on a partly paid charge', () => {
    expect(
      plan({ amount: $(300), targets: account, pairs: [pair('p0', 'ob', 150)] }).lines,
    ).toEqual([
      ['ob', $(50), false],
      ['v1', $(250), false],
    ]);
  });

  it('skips voided charges (net 0) and charges amended below what is allocated', () => {
    const targets = [
      target('void', '2026-01-01', 0),
      target('amended', '2026-01-02', 50),
      target('open', '2026-01-03', 80),
    ];
    expect(plan({ amount: $(100), targets, pairs: [pair('p0', 'amended', 60)] }).lines).toEqual([
      ['open', $(80), false],
    ]);
  });

  it('breaks date ties by creation, then id', () => {
    const targets = [
      target('b', '2026-01-01', 10, 2),
      target('c', '2026-01-01', 10, 1),
      target('a', '2026-01-01', 10, 2),
    ];
    expect(plan({ amount: $(30), targets, pairs: [] }).lines.map(([id]) => id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('splits a household payment across accounts by charge date', () => {
    const household = [target('child1-v', '2026-03-01', 120), target('child2-v', '2026-02-01', 80)];
    expect(plan({ amount: $(150), targets: household, pairs: [] }).lines).toEqual([
      ['child2-v', $(80), false],
      ['child1-v', $(70), false],
    ]);
  });
});

describe('settle (P4)', () => {
  it('writes nothing on a consistent account', () => {
    expect(
      settle({
        targets: account,
        sources: [source('p1', '2026-04-02', 500)],
        pairs: [pair('p1', 'ob', 200), pair('p1', 'v1', 300)],
      }),
    ).toEqual([]);
  });

  it('releases what an amendment took off a paid visit and applies it to open charges at once', () => {
    const targets = [target('v1', '2026-02-01', 200), target('v2', '2026-03-01', 400)];
    expect(
      settle({
        targets,
        sources: [source('p1', '2026-02-02', 300)],
        pairs: [pair('p1', 'v1', 300)],
      }),
    ).toEqual([
      { sourceId: 'p1', targetId: 'v1', amount: -$(100), kind: 'release', manual: false },
      { sourceId: 'p1', targetId: 'v2', amount: $(100), kind: 'credit_applied', manual: false },
    ]);
  });

  it('leaves the released money as credit when nothing is owed', () => {
    const targets = [target('v1', '2026-02-01', 260)];
    const sources = [source('p1', '2026-02-02', 300)];
    const pairs = [pair('p1', 'v1', 300)];
    const rows = settle({ targets, sources, pairs });
    expect(rows).toEqual([
      { sourceId: 'p1', targetId: 'v1', amount: -$(40), kind: 'release', manual: false },
    ]);
    const after = [...pairs, { ...pair('p1', 'v1', 0), amount: -$(40), order: 1 }];
    expect(unallocatedBySource(sources, after).get('p1')).toBe($(40));
  });

  it('applies existing credit to the next charge', () => {
    expect(
      settle({
        targets: [target('v1', '2026-02-01', 260), target('v2', '2026-05-01', 100)],
        sources: [source('p1', '2026-02-02', 300)],
        pairs: [pair('p1', 'v1', 260)],
      }),
    ).toEqual([
      { sourceId: 'p1', targetId: 'v2', amount: $(40), kind: 'credit_applied', manual: false },
    ]);
  });

  it('allocates a new write-off oldest first as an allocation', () => {
    expect(
      settle({
        targets: account,
        sources: [source('w1', '2026-05-01', 250)],
        pairs: [],
        newSourceIds: new Set(['w1']),
      }),
    ).toEqual([
      { sourceId: 'w1', targetId: 'ob', amount: $(200), kind: 'allocation', manual: false },
      { sourceId: 'w1', targetId: 'v1', amount: $(50), kind: 'allocation', manual: false },
    ]);
  });

  it('releases a voided payment entirely, newest allocation first', () => {
    const rows = settle({
      targets: [target('v1', '2026-02-01', 300), target('v2', '2026-03-01', 100)],
      sources: [source('p1', '2026-03-02', 0), source('c1', '2026-01-01', 50)],
      pairs: [pair('p1', 'v1', 300, 1), pair('p1', 'v2', 50, 2), pair('c1', 'v2', 50, 0)],
    });
    expect(rows).toEqual([
      { sourceId: 'p1', targetId: 'v2', amount: -$(50), kind: 'release', manual: false },
      { sourceId: 'p1', targetId: 'v1', amount: -$(300), kind: 'release', manual: false },
    ]);
  });

  it('releases a voided visit newest first across sources, then uses the freed money elsewhere', () => {
    const rows = settle({
      targets: [target('v1', '2026-02-01', 0), target('v2', '2026-03-01', 100)],
      sources: [source('w1', '2026-01-10', 100), source('p1', '2026-02-02', 50)],
      pairs: [pair('w1', 'v1', 100, 1), pair('p1', 'v1', 50, 2)],
    });
    expect(rows).toEqual([
      { sourceId: 'p1', targetId: 'v1', amount: -$(50), kind: 'release', manual: false },
      { sourceId: 'w1', targetId: 'v1', amount: -$(100), kind: 'release', manual: false },
      { sourceId: 'w1', targetId: 'v2', amount: $(100), kind: 'credit_applied', manual: false },
    ]);
  });

  it('keeps every invariant: target ≤ net, source ≤ capacity, balance identity', () => {
    const targets = [
      target('a', '2026-01-01', 120),
      target('b', '2026-01-02', 0),
      target('c', '2026-01-03', 75),
    ];
    const sources = [source('s1', '2026-01-01', 90), source('s2', '2026-01-04', 200)];
    const pairs = [pair('s1', 'b', 90, 0), pair('s2', 'a', 150, 1)];
    const rows = settle({ targets, sources, pairs });
    const after = [...pairs, ...rows.map((row, index) => ({ ...row, order: 10 + index }))];
    const allocatedTo = (id: string) =>
      after.filter((p) => p.targetId === id).reduce((sum, p) => sum + p.amount, 0n);
    expect(allocatedTo('a')).toBe($(120));
    expect(allocatedTo('b')).toBe(0n);
    expect(allocatedTo('c')).toBe($(75));
    const owed = [...outstandingByTarget(targets, after).values()].reduce((s, v) => s + v, 0n);
    const credit = [...unallocatedBySource(sources, after).values()].reduce((s, v) => s + v, 0n);
    expect(owed - credit).toBe($(120 + 75) - $(290));
  });
});

describe('refundReleases (P6)', () => {
  it('takes the unallocated credit first, then splits the rest proportionally', () => {
    expect(
      refundReleases({
        amount: $(150),
        capacity: $(500),
        pairs: [pair('p', 'v1', 160), pair('p', 'v2', 240)],
      }),
    ).toEqual([
      { targetId: 'v1', amount: $(20) },
      { targetId: 'v2', amount: $(30) },
    ]);
  });

  it('splits proportionally', () => {
    expect(
      refundReleases({
        amount: $(100),
        capacity: $(500),
        pairs: [pair('p', 'ob', 200), pair('p', 'v1', 300)],
      }),
    ).toEqual([
      { targetId: 'ob', amount: $(40) },
      { targetId: 'v1', amount: $(60) },
    ]);
  });

  it('gives odd cents to the largest remainders, the newer allocation on a tie', () => {
    expect(
      refundReleases({
        amount: 100n,
        capacity: 300n,
        pairs: [
          { ...pair('p', 'a', 0, 0), amount: 100n },
          { ...pair('p', 'b', 0, 2), amount: 100n },
          { ...pair('p', 'c', 0, 1), amount: 100n },
        ],
      }),
    ).toEqual([
      { targetId: 'a', amount: 33n },
      { targetId: 'b', amount: 34n },
      { targetId: 'c', amount: 33n },
    ]);
  });

  it('releases everything on a full refund and nothing for a refund of credit only', () => {
    const pairs = [pair('p', 'v1', 120), pair('p', 'v2', 80)];
    expect(refundReleases({ amount: $(200), capacity: $(200), pairs })).toEqual([
      { targetId: 'v1', amount: $(120) },
      { targetId: 'v2', amount: $(80) },
    ]);
    expect(refundReleases({ amount: $(40), capacity: $(240), pairs })).toEqual([]);
  });
});
