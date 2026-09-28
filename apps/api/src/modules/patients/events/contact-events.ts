import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Contact events `patients` emits (design addendum C11; CLAUDE.md §9: ids only, dispatched after
 * commit). The generic audit subscriber records each one. A merge emits none of them: its contact
 * moves follow from `PatientsMerged`.
 */

export const CONTACT_LINKED = 'ContactLinked';
export type ContactLinked = DomainEvent<
  typeof CONTACT_LINKED,
  { patientId: string; contactId: string }
>;

export const CONTACT_UNLINKED = 'ContactUnlinked';
export type ContactUnlinked = DomainEvent<
  typeof CONTACT_UNLINKED,
  { patientId: string; contactId: string }
>;

export const CONTACT_UPDATED = 'ContactUpdated';
/** The contact's own name, phone or e-mail changed, or it became a patient (`linkContactId`). */
export type ContactUpdated = DomainEvent<typeof CONTACT_UPDATED, { contactId: string }>;
