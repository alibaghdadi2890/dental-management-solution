import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Payment events (feature 5, B11): ids, amounts and the allocations they wrote, dispatched after
 * commit. The generic audit subscriber records each one.
 */

/** One allocation row as events carry it: a decimal string, negative for a release. */
export interface AllocationFact {
  sourceEntryId: string;
  targetEntryId: string;
  amount: string;
}

export const PAYMENT_RECORDED = 'PaymentRecorded';
export type PaymentRecorded = DomainEvent<
  typeof PAYMENT_RECORDED,
  {
    receiptNumber: number;
    paymentIds: string[];
    patientIds: string[];
    householdGroupId: string | null;
    amount: string;
    currency: string;
    allocations: AllocationFact[];
  }
>;

export const PAYMENT_REFUNDED = 'PaymentRefunded';
export type PaymentRefunded = DomainEvent<
  typeof PAYMENT_REFUNDED,
  {
    paymentId: string;
    refundId: string;
    patientId: string;
    amount: string;
    currency: string;
    releases: AllocationFact[];
  }
>;

export const PAYMENT_VOIDED = 'PaymentVoided';
export type PaymentVoided = DomainEvent<
  typeof PAYMENT_VOIDED,
  { receiptNumber: number; paymentIds: string[]; voidIds: string[]; patientIds: string[] }
>;

/** Existing credit covered a charge (P4), with the releases that freed it, if any. */
export const CREDIT_APPLIED = 'CreditApplied';
export type CreditApplied = DomainEvent<
  typeof CREDIT_APPLIED,
  { patientId: string; currency: string; allocations: AllocationFact[] }
>;
