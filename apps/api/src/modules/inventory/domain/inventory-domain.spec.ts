import { describe, expect, it } from 'vitest';
import { allocate, type BatchState, planCount, stockValue, takeOrder, valueOf } from './stock';
import { receiptTotal, supplierFigures, supplierStatement } from './supplier-account';

const batch = (id: string, left: number, expiresOn: string | null, receivedOn = '2026-11-01') =>
  ({ id, left, expiresOn, receivedOn }) satisfies BatchState;

describe('which batch a take-out leaves', () => {
  it('takes the batch that expires first, then the oldest, no expiry last', () => {
    const batches = [
      batch('c', 10, null, '2026-01-01'),
      batch('b', 10, '2027-02-28'),
      batch('a', 10, '2027-01-10'),
      batch('d', 10, '2027-01-10', '2026-10-01'),
    ];
    expect(takeOrder(batches).map((b) => b.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('spans batches and refuses more than is there', () => {
    const batches = [batch('a', 30, '2027-01-10'), batch('b', 50, '2027-03-01')];
    expect(allocate(batches, 40)).toEqual([
      { batchId: 'a', quantity: -30 },
      { batchId: 'b', quantity: -10 },
    ]);
    expect(allocate(batches, 81)).toBeNull();
  });

  it('starts from the batch the user chose', () => {
    const batches = [batch('a', 30, '2027-01-10'), batch('b', 50, '2027-03-01')];
    expect(allocate(batches, 60, 'b')).toEqual([
      { batchId: 'b', quantity: -50 },
      { batchId: 'a', quantity: -10 },
    ]);
  });

  it('skips empty batches', () => {
    expect(allocate([batch('a', 0, '2026-12-01'), batch('b', 5, null)], 5)).toEqual([
      { batchId: 'b', quantity: -5 },
    ]);
  });
});

describe('a count while work continues', () => {
  it('applies counted − system then to the stock as it is now', () => {
    // Counted 690 against 700; a box of 100 left meanwhile: 600 now, −10 applied → 590.
    const now = [
      batch('opening', 200, null, '2026-11-01'),
      batch('receipt', 400, null, '2026-11-19'),
    ];
    const plan = planCount(690, 700, now);
    expect(plan).toEqual({
      kind: 'change',
      quantity: -10,
      shares: [{ batchId: 'opening', quantity: -10 }],
    });
  });

  it('adds a surplus to the newest batch', () => {
    const now = [
      batch('old', 5, '2027-01-01', '2026-10-01'),
      batch('new', 5, '2027-06-01', '2026-11-10'),
    ];
    expect(planCount(14, 10, now)).toEqual({
      kind: 'change',
      quantity: 4,
      shares: [{ batchId: 'new', quantity: 4 }],
    });
  });

  it('never takes more than is there, and changes nothing when equal', () => {
    expect(planCount(0, 10, [batch('a', 3, null)])).toEqual({
      kind: 'change',
      quantity: -3,
      shares: [{ batchId: 'a', quantity: -3 }],
    });
    expect(planCount(0, 10, [batch('a', 0, null)])).toEqual({ kind: 'none' });
    expect(planCount(7, 7, [batch('a', 7, null)])).toEqual({ kind: 'none' });
  });

  it('makes the first count of an item opening stock', () => {
    expect(planCount(300, 0, [])).toEqual({ kind: 'opening', quantity: 300 });
    expect(planCount(0, 0, [])).toEqual({ kind: 'none' });
  });
});

describe('valuation at cost', () => {
  it('values each batch at its own unit cost, rounded once', () => {
    const gloves = { quantity: 300, amountCents: 2400n };
    expect(valueOf(gloves, 100)).toBe(800n);
    expect(valueOf({ quantity: 3, amountCents: 1000n }, 1)).toBe(333n);
    expect(valueOf({ quantity: 3, amountCents: 1000n }, 2)).toBe(667n);
    expect(valueOf({ quantity: 3, amountCents: 1000n }, -1)).toBe(-333n);
  });

  it('counts unpriced batches for quantity, not value, until priced', () => {
    const opening = { quantity: 300, amountCents: 2400n, left: 300 };
    const gloves = { quantity: 500, amountCents: null, left: 500 };
    const lidocaine = { quantity: 200, amountCents: null, left: 200 };
    expect(stockValue([opening, gloves, lidocaine])).toEqual({ cents: 2400n, unpricedUnits: 700 });
    // Priced at 9.00 a box of 100 and 22.00 a box of 50: 24 + 45 + 88 = 157.
    expect(
      stockValue([
        opening,
        { ...gloves, amountCents: 4500n },
        { ...lidocaine, amountCents: 8800n },
      ]),
    ).toEqual({ cents: 15700n, unpricedUnits: 0 });
  });
});

describe('a supplier account', () => {
  const sources = {
    supplier: { id: 's', openingBalance: null, openingBalanceOn: null },
    receipts: [
      {
        id: '01-receipt',
        number: 1,
        receivedOn: '2026-11-19',
        invoiceNumber: 'INV-2207',
        total: '130.00',
      },
    ],
    adjustments: [],
    payments: [
      {
        id: '02-payment',
        paidOn: '2026-11-19',
        amount: '100.00',
        method: 'cash' as const,
        reference: null,
        voided: false,
        voidReason: null,
      },
    ],
  };

  it('is the priced receipts less the live payments', () => {
    expect(receiptTotal(['45.00', '88.00'], '3.00', null)).toEqual({
      lines: '133.00',
      total: '130.00',
    });
    expect(receiptTotal(['45.00', null], null, null)).toBeNull();
    expect(supplierFigures(sources)).toEqual({
      owed: '130.00',
      paid: '100.00',
      outstanding: '30.00',
    });
    const voided = {
      ...sources,
      payments: [{ ...sources.payments[0]!, voided: true, voidReason: 'x' }],
    };
    expect(supplierFigures(voided).outstanding).toBe('130.00');
  });

  it('may go negative, and keeps a running balance', () => {
    const credit = {
      ...sources,
      supplier: { id: 's', openingBalance: '20.00', openingBalanceOn: '2026-11-01' },
      adjustments: [
        {
          id: 'a1',
          onDate: '2026-11-20',
          kind: 'credit' as const,
          amount: '60.00',
          reason: 'Return',
        },
      ],
    };
    expect(supplierFigures(credit)).toEqual({
      owed: '90.00',
      paid: '100.00',
      outstanding: '-10.00',
    });
    const result = supplierStatement(credit, '2026-11-19', '2026-11-30');
    expect(result.balanceBefore).toBe('20.00');
    expect(result.lines.map((line) => [line.kind, line.balance])).toEqual([
      ['receipt', '150.00'],
      ['payment', '50.00'],
      ['adjustment', '-10.00'],
    ]);
  });
});
