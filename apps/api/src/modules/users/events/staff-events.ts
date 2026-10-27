import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `users` emits (CLAUDE.md §9: ids and minimal facts). The generic audit subscriber records
 * each one; `compensation` ends the dentist's agreement in the deactivation's transaction (C11).
 */

export const STAFF_DEACTIVATED = 'StaffDeactivated';
/** `date`: the tenant-local day of the deactivation. */
export type StaffDeactivated = DomainEvent<
  typeof STAFF_DEACTIVATED,
  { userId: string; profileId: string; date: string }
>;
