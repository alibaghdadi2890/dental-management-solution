import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
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
    /** E.164, as normalised against the tenant's country at write time. */
    phone: text().notNull(),
    /** E.164 digits + national digits, space-separated — matches a typed local or E.164 query. */
    phoneSearch: text().notNull(),
    dateOfBirth: date(),
    sex: patientSex().notNull().default('unknown'),
    email: text(),
    address: text(),
    insurance: text(),
    emergencyContact: text(),
    notes: text(),
    medicalAlerts: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    primaryDentistUserId: uuid(),
    guardianName: text(),
    guardianPhone: text(),
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
