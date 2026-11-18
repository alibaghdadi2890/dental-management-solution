import type { PaymentMethod } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `labs` emits (CLAUDE.md §9: ids and minimal facts). `expenses` mirrors the payments in
 * their transaction (ADR-0085); the generic audit subscriber stores both, hidden without
 * `lab:money_read` (`LAB_MONEY_EVENTS`).
 */

export const LAB_PAYMENT_RECORDED = 'LabPaymentRecorded';
export type LabPaymentRecorded = DomainEvent<
  typeof LAB_PAYMENT_RECORDED,
  {
    paymentId: string;
    labId: string;
    labName: string;
    paidOn: string;
    amount: string;
    currency: string;
    method: PaymentMethod;
    reference: string | null;
    note: string | null;
  }
>;

export const LAB_PAYMENT_VOIDED = 'LabPaymentVoided';
export type LabPaymentVoided = DomainEvent<
  typeof LAB_PAYMENT_VOIDED,
  { paymentId: string; labId: string; reason: string }
>;
