import { RESEMBLANCE_DAYS } from '@dcm/contracts';

/** A payee as compared (C3): spaces and case ignored. */
export const comparablePayee = (payee: string | null): string =>
  (payee ?? '').replace(/\s+/g, '').toLocaleLowerCase();

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

interface Row {
  payee: string | null;
  amount: string;
  spentOn: string;
}

/**
 * Whether a manual expense in *Dental supplies & materials* resembles a supplier row already in
 * Expenses (feature 20a, C3): the same payee, or the same amount dated within three days either
 * side. A warning only; the user may save anyway. Pure.
 */
export function resembles(expense: Row, supplierRow: Row): boolean {
  const payee = comparablePayee(expense.payee);
  if (payee !== '' && payee === comparablePayee(supplierRow.payee)) return true;
  return (
    Number(expense.amount) === Number(supplierRow.amount) &&
    Math.abs(dayNumber(expense.spentOn) - dayNumber(supplierRow.spentOn)) <= RESEMBLANCE_DAYS
  );
}
