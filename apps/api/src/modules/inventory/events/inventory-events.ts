import type { PaymentMethod } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `inventory` emits (CLAUDE.md §9: ids and minimal facts). `expenses` mirrors a supplier
 * payment in its transaction (ADR-0098); the audit subscriber stores both, hidden without
 * `inventory:money_read` (`INVENTORY_MONEY_EVENTS`).
 */

export const SUPPLIER_PAYMENT_RECORDED = 'SupplierPaymentRecorded';
export type SupplierPaymentRecorded = DomainEvent<
  typeof SUPPLIER_PAYMENT_RECORDED,
  {
    paymentId: string;
    /** Null for a one-off purchase's payment. */
    supplierId: string | null;
    /** The supplier's name, or the one-off purchase's payee. */
    payee: string;
    paidOn: string;
    amount: string;
    currency: string;
    method: PaymentMethod;
    reference: string | null;
    note: string | null;
    branchId: string | null;
  }
>;

export const SUPPLIER_PAYMENT_VOIDED = 'SupplierPaymentVoided';
export type SupplierPaymentVoided = DomainEvent<
  typeof SUPPLIER_PAYMENT_VOIDED,
  { paymentId: string; reason: string }
>;
