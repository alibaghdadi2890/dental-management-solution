import {
  fromCents,
  type LabAdjustmentKind,
  type LabStatementKind,
  type PaymentMethod,
  toCents,
} from '@dcm/contracts';

/**
 * A lab's account (Part D, ADR-0083), computed from what is recorded, never stored: what the clinic
 * owes (the opening balance, the delivered orders at their cost from the day the work first
 * arrived, the remake and cancellation charges, the adjustments) minus the live payments. Amounts
 * are cents (`bigint`); a positive amount adds to what the clinic owes.
 */

export interface AccountMovement {
  date: string;
  kind: LabStatementKind;
  sourceId: string;
  /** Signed: a payment or a credit is negative. */
  cents: bigint;
  voided: boolean;
  orderNumber: number | null;
  patientName: string | null;
  description: string | null;
  adjustmentKind: LabAdjustmentKind | null;
  method: PaymentMethod | null;
  voidReason: string | null;
  /** Ties on one date are ordered by this (uuid v7 ids, the order things were recorded). */
  order: string;
}

export interface OrderMoneyFacts {
  id: string;
  displayNumber: number;
  patientName: string;
  items: string;
  cost: string;
  firstReceivedOn: string | null;
  cancelledOn: string | null;
  cancelCharge: string | null;
  hasTrip: boolean;
  remakeCharges: readonly { tripId: string; on: string; charge: string }[];
}

export interface AccountSources {
  lab: { id: string; openingBalance: string | null; openingBalanceOn: string | null };
  orders: readonly OrderMoneyFacts[];
  adjustments: readonly {
    id: string;
    onDate: string;
    kind: LabAdjustmentKind;
    amount: string;
    reason: string;
  }[];
  payments: readonly {
    id: string;
    paidOn: string;
    amount: string;
    method: PaymentMethod;
    reference: string | null;
    voided: boolean;
    voidReason: string | null;
  }[];
}

const blank = {
  orderNumber: null,
  patientName: null,
  description: null,
  adjustmentKind: null,
  method: null,
  voidReason: null,
  voided: false,
};

/** Every movement of the account, oldest first. */
export function movements(sources: AccountSources): AccountMovement[] {
  const rows: AccountMovement[] = [];
  const { lab } = sources;
  if (lab.openingBalance !== null && lab.openingBalanceOn !== null) {
    rows.push({
      ...blank,
      date: lab.openingBalanceOn,
      kind: 'opening',
      sourceId: lab.id,
      cents: toCents(lab.openingBalance),
      order: '',
    });
  }
  for (const order of sources.orders) {
    const about = {
      orderNumber: order.displayNumber,
      patientName: order.patientName,
      description: order.items,
    };
    if (order.firstReceivedOn !== null) {
      rows.push({
        ...blank,
        ...about,
        date: order.firstReceivedOn,
        kind: 'order',
        sourceId: order.id,
        cents: toCents(order.cost),
        order: order.id,
      });
    }
    for (const remake of order.remakeCharges) {
      rows.push({
        ...blank,
        ...about,
        date: remake.on,
        kind: 'remake',
        sourceId: order.id,
        cents: toCents(remake.charge),
        order: remake.tripId,
      });
    }
    if (
      order.cancelledOn !== null &&
      order.cancelCharge !== null &&
      toCents(order.cancelCharge) > 0n
    ) {
      rows.push({
        ...blank,
        ...about,
        date: order.cancelledOn,
        kind: 'cancellation',
        sourceId: order.id,
        cents: toCents(order.cancelCharge),
        order: `${order.id}~`,
      });
    }
  }
  for (const adjustment of sources.adjustments) {
    const cents = toCents(adjustment.amount);
    rows.push({
      ...blank,
      date: adjustment.onDate,
      kind: 'adjustment',
      sourceId: adjustment.id,
      cents: adjustment.kind === 'credit' ? -cents : cents,
      description: adjustment.reason,
      adjustmentKind: adjustment.kind,
      order: adjustment.id,
    });
  }
  for (const payment of sources.payments) {
    rows.push({
      ...blank,
      date: payment.paidOn,
      kind: 'payment',
      sourceId: payment.id,
      cents: -toCents(payment.amount),
      description: payment.reference,
      method: payment.method,
      voided: payment.voided,
      voidReason: payment.voidReason,
      order: payment.id,
    });
  }
  return rows.sort((a, b) =>
    a.date === b.date
      ? a.order < b.order
        ? -1
        : a.order > b.order
          ? 1
          : 0
      : a.date < b.date
        ? -1
        : 1,
  );
}

export interface AccountFigures {
  owed: string;
  paid: string;
  outstanding: string;
  inProgressCount: number;
  inProgressAmount: string;
}

/** Owed, paid and outstanding (may be negative), and the work sent but not yet delivered. */
export function accountFigures(sources: AccountSources): AccountFigures {
  let owed = 0n;
  let paid = 0n;
  for (const row of movements(sources)) {
    if (row.voided) continue;
    if (row.kind === 'payment') paid -= row.cents;
    else owed += row.cents;
  }
  const inProgress = sources.orders.filter(
    (order) => order.hasTrip && order.firstReceivedOn === null && order.cancelledOn === null,
  );
  return {
    owed: fromCents(owed),
    paid: fromCents(paid),
    outstanding: fromCents(owed - paid),
    inProgressCount: inProgress.length,
    inProgressAmount: fromCents(inProgress.reduce((sum, order) => sum + toCents(order.cost), 0n)),
  };
}

export interface StatementLine extends Omit<AccountMovement, 'cents' | 'order'> {
  amount: string;
  balance: string;
}

/** The statement of a period (Part D): the balance before it, its lines with a running balance. */
export function statement(
  sources: AccountSources,
  from: string,
  to: string,
): { balanceBefore: string; lines: StatementLine[]; balanceAfter: string } {
  let balance = 0n;
  let before = 0n;
  const lines: StatementLine[] = [];
  for (const { cents, order: _order, ...row } of movements(sources)) {
    if (row.date > to) break;
    if (!row.voided) balance += cents;
    if (row.date < from) {
      before = balance;
      continue;
    }
    lines.push({ ...row, amount: fromCents(cents), balance: fromCents(balance) });
  }
  return { balanceBefore: fromCents(before), lines, balanceAfter: fromCents(balance) };
}
