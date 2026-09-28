import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Contact events `patients` emits (design addendum C11; CLAUDE.md §9: ids only, dispatched after
 * commit). The generic audit subscriber records each one. A merge's link moves follow from
 * `PatientsMerged`; the contacts it re-points or folds get `ContactUpdated`.
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
/**
 * The contact's own name, phone or e-mail changed; it became a patient (`linkContactId`); or a
 * merge re-pointed it to the kept patient, or folded it into the kept patient's linked contact
 * (the folded contact is deleted; its successor is the contact linked to `PatientsMerged.keptId`).
 */
export type ContactUpdated = DomainEvent<typeof CONTACT_UPDATED, { contactId: string }>;
