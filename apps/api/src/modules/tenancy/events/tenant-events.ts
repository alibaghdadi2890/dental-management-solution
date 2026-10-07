import type { DomainEvent } from '../../../platform/events/domain-event';

export const TENANT_CURRENCY_CHANGED = 'TenantCurrencyChanged';
/**
 * Published by `updateSettings` inside its transaction when the currency really changes, so a
 * module holding money in the old currency can veto it (`billing`, ADR-0035).
 */
export type TenantCurrencyChanged = DomainEvent<
  typeof TENANT_CURRENCY_CHANGED,
  { from: string; to: string }
>;
