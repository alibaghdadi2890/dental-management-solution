import type { ContactLinkInput, ContactRelationship, PatientContact } from '@dcm/contracts';
import type { PendingContact } from './patient-form';

/** A contact's three roles for a patient, in the order they are shown (addendum C2). */
export const CONTACT_ROLES = ['guardian', 'billing', 'emergency'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export type RoleFlags = Record<ContactRole, boolean>;

/** Each role's flag on a link (`ContactLinkInput`, `PatientContact`, `ContactLinkPatch`). */
export const ROLE_FIELD = {
  guardian: 'isGuardian',
  billing: 'isBillingContact',
  emergency: 'isEmergencyContact',
} as const satisfies Record<ContactRole, keyof ContactLinkInput & keyof PatientContact>;

/** Each role's primary flag on a `PatientContact` (and a `ContactLinkPatch`). */
export const PRIMARY_FIELD = {
  guardian: 'isPrimaryGuardian',
  billing: 'isPrimaryBilling',
  emergency: 'isPrimaryEmergency',
} as const satisfies Record<ContactRole, keyof PatientContact>;

export const NO_ROLES: RoleFlags = { guardian: false, billing: false, emergency: false };

export function hasRole(roles: RoleFlags): boolean {
  return CONTACT_ROLES.some((role) => roles[role]);
}

export function rolesOf(link: Pick<ContactLinkInput, (typeof ROLE_FIELD)[ContactRole]>): RoleFlags {
  return {
    guardian: link.isGuardian,
    billing: link.isBillingContact,
    emergency: link.isEmergencyContact,
  };
}

/** Role flags as a link's fields (`isGuardian`, …). */
export function roleFields(roles: RoleFlags) {
  return {
    isGuardian: roles.guardian,
    isBillingContact: roles.billing,
    isEmergencyContact: roles.emergency,
  };
}

/**
 * One contact as every patient panel shows it (addendum "Frontend"): who (name, phone, the patient
 * they are), how they relate, and their roles — a pending create link or a saved one alike.
 */
export interface ContactRowModel {
  /** A list key: the pending link's own key, or the contact id. */
  key: string;
  fullName: string;
  /** E.164, or null (a contact linked to a patient recorded without a phone). */
  phone: string | null;
  /** The patient this contact is ("Patient P-…"); `id` is unknown for a pending lookup hit. */
  patient: { id: string | null; number: string; archived: boolean } | null;
  relationship: ContactRelationship;
  roles: RoleFlags;
  /** The primary of each role; null while pending (the server makes the first holder primary). */
  primary: RoleFlags | null;
}

export function rowOfPending({ key, link, display }: PendingContact): ContactRowModel {
  return {
    key,
    fullName: display.fullName,
    phone: display.phone,
    patient:
      display.patientNumber === null
        ? null
        : {
            id: 'patientId' in link.target ? link.target.patientId : null,
            number: display.patientNumber,
            archived: display.archived,
          },
    relationship: link.relationship,
    roles: rolesOf(link),
    primary: null,
  };
}

export function rowOfLink(link: PatientContact): ContactRowModel {
  const { contact } = link;
  return {
    key: contact.id,
    fullName: contact.fullName,
    phone: contact.phone,
    patient: contact.linkedPatient && {
      id: contact.linkedPatient.id,
      number: contact.linkedPatient.displayNumber,
      archived: contact.linkedPatient.archived,
    },
    relationship: link.relationship,
    roles: rolesOf(link),
    primary: {
      guardian: link.isPrimaryGuardian,
      billing: link.isPrimaryBilling,
      emergency: link.isPrimaryEmergency,
    },
  };
}
