import { type AnyColumn, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { contacts, patients } from './schema';

/**
 * How a contact resolves in SQL (design addendum C6): a contact linked to a patient reads its
 * name, phone and search columns from that patient (`linked_patient`, left-joined on
 * `contacts.linked_patient_id`); an unlinked one reads its own. Shared by the contacts
 * repositories and the patients search (contact-phone match, primary guardian).
 */
export const linkedPatients = alias(patients, 'linked_patient');

/**
 * `left join patients linked_patient on ...`, for raw SQL subqueries: interpolating the alias alone
 * renders just its name (the query builder's `leftJoin(linkedPatients, ...)` needs no help).
 */
export const joinLinkedPatient = sql`left join ${patients} ${linkedPatients} on ${linkedPatients.id} = ${contacts.linkedPatientId}`;

function resolved<T>(own: AnyColumn, linked: AnyColumn): SQL<T> {
  return sql<T>`case when ${contacts.linkedPatientId} is null then ${own} else ${linked} end`;
}

/** Never null: the `contacts_linked_or_named` check. */
export const resolvedFullName = resolved<string>(contacts.fullName, linkedPatients.fullName);
export const resolvedPhone = resolved<string | null>(contacts.phone, linkedPatients.phone);
export const resolvedNameKey = resolved<string>(contacts.nameKey, linkedPatients.nameKey);
export const resolvedPhoneSearch = resolved<string | null>(
  contacts.phoneSearch,
  linkedPatients.phoneSearch,
);
