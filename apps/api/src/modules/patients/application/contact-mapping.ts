import type { PatientContact } from '@dcm/contracts';
import { resolveContact, type LinkState } from '../domain/contacts';
import type { PatientContactRecord } from '../persistence/patient-contacts.repository';

/** One contact of a patient as the contract reads it (addendum C6). */
export function toPatientContact(record: PatientContactRecord): PatientContact {
  return {
    contact: resolveContact(record.contact, record.linkedPatient),
    relationship: record.link.relationship,
    isGuardian: record.link.isGuardian,
    isBillingContact: record.link.isBillingContact,
    isEmergencyContact: record.link.isEmergencyContact,
    isPrimaryGuardian: record.link.isPrimaryGuardian,
    isPrimaryBilling: record.link.isPrimaryBilling,
    isPrimaryEmergency: record.link.isPrimaryEmergency,
  };
}

/**
 * A link as an audit entry records it (`contact.link`, `contact.unlink`, `contact.roles`; addendum
 * C11): who (resolved name), how related, which roles. No phone or e-mail.
 */
export interface LinkAudit {
  contactId: string;
  fullName: string;
  relationship: LinkState['relationship'];
  isGuardian: boolean;
  isBillingContact: boolean;
  isEmergencyContact: boolean;
  isPrimaryGuardian: boolean;
  isPrimaryBilling: boolean;
  isPrimaryEmergency: boolean;
}

export function linkAudit(link: LinkState, fullName: string): LinkAudit {
  return {
    contactId: link.contactId,
    fullName,
    relationship: link.relationship,
    isGuardian: link.isGuardian,
    isBillingContact: link.isBillingContact,
    isEmergencyContact: link.isEmergencyContact,
    isPrimaryGuardian: link.isPrimaryGuardian,
    isPrimaryBilling: link.isPrimaryBilling,
    isPrimaryEmergency: link.isPrimaryEmergency,
  };
}
