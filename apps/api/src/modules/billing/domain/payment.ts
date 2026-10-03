import type { LedgerEntryKind, PaymentKind, PaymentMethod } from '@dcm/contracts';
import type { AllocationSource, AllocationTarget } from './allocate';

/** One `payments` row, as the repository maps it (CLAUDE.md §7). */
export interface Payment {
  id: string;
  patientId: string;
  kind: PaymentKind;
  /** Positive decimal string. */
  amount: string;
  currency: string;
  method: PaymentMethod;
  /** `YYYY-MM-DD`. */
  paidAt: string;
  reference: string | null;
  note: string | null;
  reason: string | null;
  receiptNumber: number;
  householdGroupId: string | null;
  payerContactId: string | null;
  reversesPaymentId: string | null;
  ledgerEntryId: string;
  idempotencyKey: string | null;
  balanceAfter: string | null;
  branchId: string | null;
  recordedBy: string;
  createdAt: Date;
}

/** A charge of an account, with what is allocated to it (cents). */
export interface AccountTarget extends AllocationTarget {
  patientId: string;
  kind: LedgerEntryKind;
  visitId: string | null;
  currency: string;
  allocated: bigint;
}

/** A payment or credit entry of an account; `capacity` already nets refunds and voids. */
export interface AccountSource extends AllocationSource {
  patientId: string;
  kind: LedgerEntryKind;
  currency: string;
}

/** The live allocation of one source to one target (Σ of its rows, > 0), with target details. */
export interface AllocatedLine {
  sourceId: string;
  targetId: string;
  patientId: string;
  kind: LedgerEntryKind;
  visitId: string | null;
  date: string;
  amount: bigint;
}
