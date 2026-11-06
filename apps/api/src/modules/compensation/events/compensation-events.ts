import type { COMPENSATION_EVENTS, PaymentMethod } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `compensation` emits (CLAUDE.md §9: ids and minimal facts). The generic audit subscriber
 * records each one; `audit` hides them from anyone without `compensation:manage` by these names
 * (`COMPENSATION_EVENTS`, ADR-0060). `expenses` consumes the payout events in the transaction.
 */

type Name = (typeof COMPENSATION_EVENTS)[number];

export const AGREEMENT_CREATED = 'AgreementCreated' satisfies Name;
export type AgreementCreated = DomainEvent<
  typeof AGREEMENT_CREATED,
  { agreementId: string; profileId: string; effectiveFrom: string }
>;

export const AGREEMENT_ENDED = 'AgreementEnded' satisfies Name;
export type AgreementEnded = DomainEvent<
  typeof AGREEMENT_ENDED,
  { agreementId: string; profileId: string; effectiveTo: string }
>;

export const AGREEMENT_SUPERSEDED = 'AgreementSuperseded' satisfies Name;
export type AgreementSuperseded = DomainEvent<
  typeof AGREEMENT_SUPERSEDED,
  { agreementId: string; profileId: string }
>;

export const ADJUSTMENT_RECORDED = 'AdjustmentRecorded' satisfies Name;
export const ADJUSTMENT_VOIDED = 'AdjustmentVoided' satisfies Name;
/** An adjustment recorded or voided, dated `date`. */
export type MoneyRowEvent = DomainEvent<
  typeof ADJUSTMENT_RECORDED | typeof ADJUSTMENT_VOIDED,
  { id: string; profileId: string; date: string }
>;

export const PAYOUT_RECORDED = 'PayoutRecorded' satisfies Name;
/**
 * A payout recorded, with what `expenses` needs to mirror it as a Dentist compensation row in the
 * same transaction (ADR-0076).
 */
export type PayoutRecorded = DomainEvent<
  typeof PAYOUT_RECORDED,
  {
    id: string;
    profileId: string;
    date: string;
    amount: string;
    currency: string;
    method: PaymentMethod;
    reference: string | null;
    note: string | null;
  }
>;

export const PAYOUT_VOIDED = 'PayoutVoided' satisfies Name;
/** A payout voided; its mirror in Expenses is voided with the same reason. */
export type PayoutVoided = DomainEvent<
  typeof PAYOUT_VOIDED,
  { id: string; profileId: string; date: string; reason: string }
>;

export const PERIOD_CLOSED = 'PeriodClosed' satisfies Name;
export const PERIOD_REOPENED = 'PeriodReopened' satisfies Name;
export type PeriodEvent = DomainEvent<
  typeof PERIOD_CLOSED | typeof PERIOD_REOPENED,
  { profileId: string; month: string }
>;
