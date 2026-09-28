import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  deletedAtColumn,
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

/** Stable, not tenant-extendable (CLAUDE.md §7). */
export const patientSex = pgEnum('patient_sex', ['female', 'male', 'other', 'unknown']);

/** The contact's relation *to the patient* (design addendum C2); stable, not tenant-extendable. */
export const contactRelationship = pgEnum('contact_relationship', [
  'parent',
  'spouse',
  'child',
  'sibling',
  'caregiver',
  'other',
]);

/**
 * Patient records (feature 3). `nameKey`/`phoneSearch` are internal search columns the repository
 * derives from `fullName`/`phone` (`domain/name-key.ts`) and never exposes over HTTP. Archive is
 * `deletedAt` (design Q11); a merged-away record additionally carries `mergedIntoId`.
 */
export const patients = pgTable(
  'patients',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    displayNumber: text().notNull(),
    fullName: text().notNull(),
    nameKey: text().notNull(),
    /**
     * E.164, as normalised against the tenant's country at write time. Null only for a minor
     * recorded without one (design addendum C3, enforced by the service against the tenant's TZ).
     */
    phone: text(),
    /**
     * E.164 digits + national digits, space-separated — matches a typed local or E.164 query.
     * Null when there is no phone, so a digit search never matches the record by phone.
     */
    phoneSearch: text(),
    dateOfBirth: date(),
    sex: patientSex().notNull().default('unknown'),
    email: text(),
    address: text(),
    insurance: text(),
    notes: text(),
    medicalAlerts: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** `staff_profiles.id` (ADR-0020); no cross-module foreign key (CLAUDE.md §4 rule 1). */
    primaryDentistId: uuid(),
    /**
     * Feature 6 import. Unique across every row for the tenant, including archived and merged-away
     * ones (`patients_external_id_unique` carries no `deleted_at` filter) — a re-import must clear
     * or change an archived record's `externalId` before reusing it, never reassign it silently.
     */
    externalId: text(),
    mergedIntoId: uuid(),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('patients_tenant_idx').on(table.tenantId),
    // Target of the contacts/patient_contacts composite foreign keys: links stay in one tenant.
    unique('patients_tenant_id_unique').on(table.tenantId, table.id),
    uniqueIndex('patients_display_number_unique').on(table.tenantId, table.displayNumber),
    uniqueIndex('patients_external_id_unique')
      .on(table.tenantId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    // Duplicate detection: active rows sharing a name + date of birth (`duplicateRows`, `findTwins`).
    index('patients_name_key_dob_idx')
      .on(table.tenantId, table.nameKey, table.dateOfBirth)
      .where(sql`${table.deletedAt} is null`),
    // `sort=recent` (the palette's 5 most-recently-updated active patients, design Q15).
    index('patients_tenant_updated_idx').on(table.tenantId, table.updatedAt),
    // A merged-away record is always archived too (design Q11: `restore` on it is refused via
    // `mergedIntoId`, not by it being somehow still active); never merged into itself.
    check(
      'patients_merged_requires_archived',
      sql`${table.mergedIntoId} is null or ${table.deletedAt} is not null`,
    ),
    check('patients_not_merged_into_self', sql`${table.mergedIntoId} <> ${table.id}`),
    tenantIsolationPolicy(),
  ],
);

/** One row per tenant: the source of the next `display_number` (`PatientCountersRepository`). */
export const patientCounters = pgTable(
  'patient_counters',
  {
    tenantId: tenantIdColumn().primaryKey(),
    lastValue: integer().notNull(),
    ...timestamps(),
  },
  () => [tenantIsolationPolicy()],
);

/**
 * People known to the clinic who relate to patients as guardians, billing or emergency contacts
 * (design addendum C1, ADR-0019). A contact *linked* to a patient (`linkedPatientId`) stores no
 * name/phone/email of its own — they are read from the patient record — so either it is linked or
 * it has a name. At most one live contact per linked patient. `nameKey`/`phoneSearch` are internal
 * search columns derived by the repository, as on `patients`.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    fullName: text(),
    /** `nameKey(fullName)` (`domain/name-key.ts`) for the lookup; null exactly when `fullName` is. */
    nameKey: text(),
    /** E.164, as normalised against the tenant's country at write time. */
    phone: text(),
    phoneSearch: text(),
    email: text(),
    linkedPatientId: uuid(),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('contacts_tenant_idx').on(table.tenantId),
    // Target of the patient_contacts composite foreign key.
    unique('contacts_tenant_id_unique').on(table.tenantId, table.id),
    foreignKey({
      name: 'contacts_linked_patient_fk',
      columns: [table.tenantId, table.linkedPatientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    uniqueIndex('contacts_linked_patient_unique')
      .on(table.tenantId, table.linkedPatientId)
      .where(sql`${table.linkedPatientId} is not null and ${table.deletedAt} is null`),
    check(
      'contacts_linked_or_named',
      sql`${table.linkedPatientId} is not null or ${table.fullName} is not null`,
    ),
    check(
      'contacts_name_key_with_name',
      sql`(${table.fullName} is null) = (${table.nameKey} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A contact's link to a patient (design addendum C2): the relationship, the role flags and at most
 * one primary per role per patient. A junction row: unlinking hard-deletes it (CLAUDE.md §7).
 */
export const patientContacts = pgTable(
  'patient_contacts',
  {
    tenantId: tenantIdColumn(),
    patientId: uuid().notNull(),
    contactId: uuid().notNull(),
    relationship: contactRelationship().notNull(),
    isGuardian: boolean().notNull().default(false),
    isBillingContact: boolean().notNull().default(false),
    isEmergencyContact: boolean().notNull().default(false),
    isPrimaryGuardian: boolean().notNull().default(false),
    isPrimaryBilling: boolean().notNull().default(false),
    isPrimaryEmergency: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: 'patient_contacts_pk', columns: [table.patientId, table.contactId] }),
    index('patient_contacts_tenant_idx').on(table.tenantId),
    index('patient_contacts_contact_idx').on(table.contactId),
    foreignKey({
      name: 'patient_contacts_patient_fk',
      columns: [table.tenantId, table.patientId],
      foreignColumns: [patients.tenantId, patients.id],
    }),
    foreignKey({
      name: 'patient_contacts_contact_fk',
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    check(
      'patient_contacts_has_role',
      sql`${table.isGuardian} or ${table.isBillingContact} or ${table.isEmergencyContact}`,
    ),
    check(
      'patient_contacts_primary_guardian_role',
      sql`not ${table.isPrimaryGuardian} or ${table.isGuardian}`,
    ),
    check(
      'patient_contacts_primary_billing_role',
      sql`not ${table.isPrimaryBilling} or ${table.isBillingContact}`,
    ),
    check(
      'patient_contacts_primary_emergency_role',
      sql`not ${table.isPrimaryEmergency} or ${table.isEmergencyContact}`,
    ),
    uniqueIndex('patient_contacts_primary_guardian_unique')
      .on(table.tenantId, table.patientId)
      .where(sql`${table.isPrimaryGuardian}`),
    uniqueIndex('patient_contacts_primary_billing_unique')
      .on(table.tenantId, table.patientId)
      .where(sql`${table.isPrimaryBilling}`),
    uniqueIndex('patient_contacts_primary_emergency_unique')
      .on(table.tenantId, table.patientId)
      .where(sql`${table.isPrimaryEmergency}`),
    tenantIsolationPolicy(),
  ],
);
