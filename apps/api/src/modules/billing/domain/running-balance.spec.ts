import { describe, expect, it } from 'vitest';
import { type RunningEntry, runningBalance } from './running-balance';

const entry = (
  id: string,
  kind: RunningEntry['kind'],
  amount: number,
  date: string,
  createdAt: number,
  voided = false,
): RunningEntry => ({ id, kind, amount: BigInt(amount * 100), date, createdAt, voided });

describe('runningBalance (Remaining, statement)', () => {
  it('counts charges dated on or before a payment, even when posted after it', () => {
    const lines = runningBalance([
      entry('ob', 'opening_balance', 200, '2026-01-01', 1),
      entry('pay', 'payment', -500, '2026-02-01', 2),
      entry('v1', 'visit_charge', 300, '2026-02-01', 3),
      entry('v2', 'visit_charge', 400, '2026-03-01', 4),
    ]);
    expect(lines.map(({ entry: e, balance }) => [e.id, balance])).toEqual([
      ['ob', 20000n],
      ['v1', 50000n],
      ['pay', 0n],
      ['v2', 40000n],
    ]);
  });

  it('voided payments and their voids add nothing; refunds count', () => {
    const lines = runningBalance([
      entry('v1', 'visit_charge', 300, '2026-02-01', 1),
      entry('p1', 'payment', -300, '2026-02-01', 2, true),
      entry('x1', 'payment_void', 300, '2026-02-03', 3, true),
      entry('p2', 'payment', -300, '2026-02-04', 4),
      entry('r2', 'payment_refund', 100, '2026-02-05', 5),
    ]);
    expect(lines.map(({ entry: e, balance }) => [e.id, balance])).toEqual([
      ['v1', 30000n],
      ['p1', 30000n],
      ['x1', 30000n],
      ['p2', 0n],
      ['r2', 10000n],
    ]);
  });
});
