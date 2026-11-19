import {
  fromCents,
  type PaymentMethod,
  type SupplierAdjustmentKind,
  type SupplierStatementKind,
  toCents,
} from '@dcm/contracts';

/**
 * A supplier's account (Part D, ADR-0098), computed, never stored: the opening balance, each
 * priced live receipt at its total from its date received, the charges, minus the credits, minus
 * the live payments. Receipts to price are not owed yet. Cents (`bigint`); a positive amount adds
 * to what the clinic owes.
 */

export interface SupplierAccountSources {
  supplier: { id: string; openingBalance: string | null; openingBalanceOn: string | null };
  /** Live, priced receipts with their total. */
  receipts: readonly {
    id: string;
    number: number;
    receivedOn: string;
    invoiceNumber: string | null;
    total: string;
  }[];
  adjustments: readonly {
    id: string;
    onDate: string;
    kind: SupplierAdjustmentKind;
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

interface AccountLine {
  date: string;
  kind: SupplierStatementKind;
  sourceId: string;
  cents: bigint;
  receiptNumber: number | null;
  description: string | null;
  adjustmentKind: SupplierAdjustmentKind | null;
  method: PaymentMethod | null;
  voided: boolean;
  voidReason: string | null;
  /** Ties on one date follow the order things were recorded (uuid v7). */
  order: string;
}

const blank = {
  receiptNumber: null,
  description: null,
  adjustmentKind: null,
  method: null,
  voided: false,
  voidReason: null,
};

function lines(sources: SupplierAccountSources): AccountLine[] {
  const rows: AccountLine[] = [];
  const { supplier } = sources;
  if (supplier.openingBalance !== null && supplier.openingBalanceOn !== null) {
    rows.push({
      ...blank,
      date: supplier.openingBalanceOn,
      kind: 'opening',
      sourceId: supplier.id,
      cents: toCents(supplier.openingBalance),
      order: '',
    });
  }
  for (const receipt of sources.receipts) {
    rows.push({
      ...blank,
      date: receipt.receivedOn,
      kind: 'receipt',
      sourceId: receipt.id,
      cents: toCents(receipt.total),
      receiptNumber: receipt.number,
      description: receipt.invoiceNumber,
      order: receipt.id,
    });
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
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order));
}

/** Owed, paid and outstanding (which may be negative). */
export function supplierFigures(sources: SupplierAccountSources): {
  owed: string;
  paid: string;
  outstanding: string;
} {
  let owed = 0n;
  let paid = 0n;
  for (const row of lines(sources)) {
    if (row.voided) continue;
    if (row.kind === 'payment') paid -= row.cents;
    else owed += row.cents;
  }
  return { owed: fromCents(owed), paid: fromCents(paid), outstanding: fromCents(owed - paid) };
}

export interface SupplierStatementRow extends Omit<AccountLine, 'cents' | 'order'> {
  amount: string;
  balance: string;
}

/** A period's statement: the balance before it, its lines with a running balance, after. */
export function supplierStatement(
  sources: SupplierAccountSources,
  from: string,
  to: string,
): { balanceBefore: string; lines: SupplierStatementRow[]; balanceAfter: string } {
  let balance = 0n;
  let before = 0n;
  const rows: SupplierStatementRow[] = [];
  for (const { cents, order: _order, ...row } of lines(sources)) {
    if (row.date > to) break;
    if (!row.voided) balance += cents;
    if (row.date < from) {
      before = balance;
      continue;
    }
    rows.push({ ...row, amount: fromCents(cents), balance: fromCents(balance) });
  }
  return { balanceBefore: fromCents(before), lines: rows, balanceAfter: fromCents(balance) };
}

/** A receipt's total (B1): its lines − the discount + tax and other charges; null while to price. */
export function receiptTotal(
  lineAmounts: readonly (string | null)[],
  discount: string | null,
  charges: string | null,
): { lines: string; total: string } | null {
  if (lineAmounts.some((amount) => amount === null)) return null;
  const sum = lineAmounts.reduce((total, amount) => total + toCents(amount as string), 0n);
  const total = sum - toCents(discount ?? '0') + toCents(charges ?? '0');
  return { lines: fromCents(sum), total: fromCents(total) };
}
