import type { ContactRelationship, ContactView, PatientContact } from '@dcm/contracts';
import { CONTACT_ROLES, type RoleFlags, rolesOf } from './contact-rows';

interface Side {
  patient: { id: string; displayNumber: string };
  contacts: readonly PatientContact[];
}

/** A contact the merged record keeps: roles from both records together, and which record(s) it
 * comes from (display numbers, the kept record's first). */
export interface KeptContact {
  contact: ContactView;
  relationship: ContactRelationship;
  roles: RoleFlags;
  from: string[];
}

export interface MergeContacts {
  kept: KeptContact[];
  /** Contacts that are one of the two records themselves: after the merge they would be the kept
   * patient's own contact, so the server removes that link (addendum C8). */
  removed: { contact: ContactView; number: string }[];
}

/**
 * The merge panel's "Contacts — will be kept" (addendum C8, as the server does it): the kept
 * record's contacts, then the dropped record's other ones, each contact once — on both records,
 * the roles are OR-ed and the kept record's relationship wins.
 */
export function mergeContacts(kept: Side, dropped: Side): MergeContacts {
  const records = new Set([kept.patient.id, dropped.patient.id]);
  const byContact = new Map<string, KeptContact>();
  const removed = new Map<string, MergeContacts['removed'][number]>();

  for (const side of [kept, dropped]) {
    for (const link of side.contacts) {
      const { contact } = link;
      const self = contact.linkedPatient;
      if (self !== null && records.has(self.id)) {
        if (!removed.has(contact.id)) {
          removed.set(contact.id, { contact, number: self.displayNumber });
        }
        continue;
      }
      const roles = rolesOf(link);
      const known = byContact.get(contact.id);
      if (known) {
        for (const role of CONTACT_ROLES) known.roles[role] ||= roles[role];
        if (!known.from.includes(side.patient.displayNumber)) {
          known.from.push(side.patient.displayNumber);
        }
        continue;
      }
      byContact.set(contact.id, {
        contact,
        relationship: link.relationship,
        roles,
        from: [side.patient.displayNumber],
      });
    }
  }
  return { kept: [...byContact.values()], removed: [...removed.values()] };
}
