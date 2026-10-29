import { type PaymentHistoryItem, toCents } from '@dcm/contracts';

/** How many of the patient's latest payments the refund picker lists. */
const LATEST = 10;

/** What is left to refund of a payment; 0 once voided or refunded in full. */
export const refundableOf = (payment: PaymentHistoryItem): bigint =>
  payment.voided ? 0n : toCents(payment.amount) - toCents(payment.refunded);

/** The patient's latest payments, newest first (the account lists them so). */
export const latestPayments = (history: readonly PaymentHistoryItem[]) =>
  history.filter((item) => item.kind === 'payment').slice(0, LATEST);
