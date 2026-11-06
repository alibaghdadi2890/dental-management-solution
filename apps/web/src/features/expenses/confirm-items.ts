import {
  type ConfirmItemsRequest,
  type FixedItem,
  fromCents,
  type PaymentMethod,
  toCents,
} from '@dcm/contracts';
import { parseAmount } from '@/lib/amount';

/** One waiting month in the bulk confirmation, as the user is setting it. */
export interface ConfirmRow {
  item: FixedItem;
  amountText: string;
  method: PaymentMethod | null;
}

export const rowsOf = (items: readonly FixedItem[]): ConfirmRow[] =>
  items.map((item) => ({ item, amountText: item.amount, method: item.method }));

/** The amount a row would confirm, or why it can't. */
export function rowAmount(
  row: ConfirmRow,
  locale: string,
): { amount: string } | { problem: 'required' | 'amount' } {
  const amount = parseAmount(row.amountText, locale);
  if (amount === '') return { problem: 'required' };
  if (amount === null || toCents(amount) <= 0n) return { problem: 'amount' };
  return { amount };
}

/** The batch total of the rows that read as amounts. */
export function batchTotal(rows: readonly ConfirmRow[], locale: string): string {
  return fromCents(
    rows.reduce((total, row) => {
      const read = rowAmount(row, locale);
      return 'amount' in read ? total + toCents(read.amount) : total;
    }, 0n),
  );
}

/**
 * The single confirmation (A3): every row with its own amount and method, on one payment date,
 * the rest as the month was generated. Null while a row has no valid amount or no method.
 */
export function confirmRequest(
  rows: readonly ConfirmRow[],
  spentOn: string,
  locale: string,
): ConfirmItemsRequest | null {
  const items: ConfirmItemsRequest['items'] = [];
  for (const row of rows) {
    const read = rowAmount(row, locale);
    if (!('amount' in read) || row.method === null) return null;
    items.push({
      itemId: row.item.id,
      spentOn,
      amount: read.amount,
      method: row.method,
      categoryId: row.item.categoryId,
      payee: row.item.payee,
      reference: null,
      description: row.item.name,
      branchId: row.item.branchId,
    });
  }
  return items.length > 0 ? { items } : null;
}
