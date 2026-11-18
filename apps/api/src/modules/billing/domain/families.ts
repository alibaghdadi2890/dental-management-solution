/**
 * Families by payer (feature 5, ADR-0028; families C): who a patient's family is, for Outstanding
 * grouped by payer and the dashboard's largest balances. Pure.
 */

/** What the grouping needs of a billing contact (a `ContactView` fits). */
export interface FamilyContact {
  id: string;
  fullName: string;
  linkedPatient: { id: string; archived: boolean } | null;
}

/**
 * The family key of each patient, given each patient's primary billing contact (`billing`, by
 * patient id): that contact's id; else, for a patient who is someone's billing contact, their own
 * contact's id (a parent who is a patient joins the family they pay for, unless someone else bills
 * them); else the patient's own id (a family of one).
 */
export function familyKeyOf(
  billing: ReadonlyMap<string, FamilyContact>,
): (patientId: string) => string {
  const payers = new Map<string, string>();
  for (const contact of billing.values()) {
    if (contact.linkedPatient) payers.set(contact.linkedPatient.id, contact.id);
  }
  return (patientId) => billing.get(patientId)?.id ?? payers.get(patientId) ?? patientId;
}

/** The payer of a family: the contact, with their patient record unless it is archived. */
export function payerOf(contact: FamilyContact): {
  contactId: string;
  name: string;
  patientId: string | null;
} {
  return {
    contactId: contact.id,
    name: contact.fullName,
    patientId:
      contact.linkedPatient && !contact.linkedPatient.archived ? contact.linkedPatient.id : null,
  };
}
