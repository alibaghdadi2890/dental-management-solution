import type { PAYROLL_EVENTS, PaymentMethod } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `payroll` emits (CLAUDE.md §9). `expenses` consumes both in the transaction to keep the
 * *Salaries* row of each payment (ADR-0076). The generic audit subscriber stores them, and `audit`
 * hides them from anyone without `payroll:read` by these names (`PAYROLL_EVENTS`, ADR-0080).
 */

type Name = (typeof PAYROLL_EVENTS)[number];

export const PAYROLL_PAYMENT_CONFIRMED = 'PayrollPaymentConfirmed' satisfies Name;
/** A salary paid: what the *Salaries* expense needs, the net as paid. */
export type PayrollPaymentConfirmed = DomainEvent<
  typeof PAYROLL_PAYMENT_CONFIRMED,
  {
    paymentId: string;
    employeeId: string;
    employeeName: string;
    month: string;
    net: string;
    currency: string;
    paidOn: string;
    method: PaymentMethod;
    branchId: string | null;
  }
>;

export const PAYROLL_PAYMENT_VOIDED = 'PayrollPaymentVoided' satisfies Name;
export type PayrollPaymentVoided = DomainEvent<
  typeof PAYROLL_PAYMENT_VOIDED,
  { paymentId: string; employeeId: string; month: string; reason: string }
>;
