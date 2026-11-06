import {
  netPay,
  type PayrollAdjustment,
  type PayrollAdjustmentKind,
  rawNetCents,
  toCents,
} from '@dcm/contracts';
import { parseAmount } from '@/lib/amount';

/** One adjustment row as typed. */
export interface AdjustmentRow {
  kind: PayrollAdjustmentKind;
  label: string;
  amountText: string;
}

export type RowProblem = 'label' | 'amount' | 'signed';

export const rowsFrom = (adjustments: readonly PayrollAdjustment[]): AdjustmentRow[] =>
  adjustments.map((adjustment) => ({
    kind: adjustment.kind,
    label: adjustment.label,
    amountText: adjustment.amount,
  }));

/** A row as an adjustment, or what is wrong with it (a bonus or deduction is typed positive). */
export function readRow(
  row: AdjustmentRow,
  locale: string,
): { adjustment: PayrollAdjustment } | { problem: RowProblem } {
  if (row.label.trim() === '') return { problem: 'label' };
  const signed = row.kind === 'other';
  const negative = signed && row.amountText.trim().startsWith('-');
  const amount = parseAmount(negative ? row.amountText.trim().slice(1) : row.amountText, locale);
  if (amount === '' || amount === null || toCents(amount) === 0n) {
    return { problem: signed ? 'signed' : 'amount' };
  }
  return {
    adjustment: {
      kind: row.kind,
      label: row.label.trim(),
      amount: negative ? `-${amount}` : amount,
    },
  };
}

/**
 * The line as it would be with these rows: the adjustments when every row reads, the net shown
 * (never below zero) and whether the deductions outweigh the base.
 */
export function preview(
  base: string | null,
  rows: readonly AdjustmentRow[],
  locale: string,
): { adjustments: PayrollAdjustment[] | null; net: string; negative: boolean } {
  const read = rows.map((row) => readRow(row, locale));
  const adjustments = read.flatMap((result) => ('adjustment' in result ? [result.adjustment] : []));
  const raw = rawNetCents(base, adjustments);
  return {
    adjustments: adjustments.length === rows.length ? adjustments : null,
    net: netPay(base, adjustments),
    negative: raw !== null && raw < 0n,
  };
}
