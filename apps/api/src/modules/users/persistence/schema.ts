import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

/**
 * A staff member of a tenant, keyed by the global auth user id (D7): the same person can later
 * have a profile in several clinics. `practitioner_type` is text + Zod (tenants may extend it).
 * A dentist has specialties, one of them primary; nobody else has any (ADR-0050).
 */
export const staffProfiles = pgTable(
  'staff_profiles',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    authUserId: uuid().notNull(),
    displayName: text().notNull(),
    title: text(),
    practitionerType: text().notNull(),
    primarySpecialty: text(),
    /** Every specialty, the primary included, in the order chosen. */
    specialties: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    phone: text(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index('staff_profiles_tenant_idx').on(table.tenantId),
    unique('staff_profiles_tenant_user_unique').on(table.tenantId, table.authUserId),
    check(
      'staff_profiles_specialty_iff_dentist',
      sql`(${table.practitionerType} = 'dentist') = (${table.primarySpecialty} is not null)`,
    ),
    check(
      'staff_profiles_primary_iff_specialties',
      sql`(${table.primarySpecialty} is null) = (cardinality(${table.specialties}) = 0)`,
    ),
    check(
      'staff_profiles_primary_among_specialties',
      sql`${table.primarySpecialty} is null or ${table.primarySpecialty} = any(${table.specialties})`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * Branches a staff member works in; the order of assignment decides their default branch.
 * Branch ids are validated through `tenancy` (no cross-module foreign key). Junction: hard delete.
 */
export const staffBranches = pgTable(
  'staff_branches',
  {
    tenantId: tenantIdColumn(),
    authUserId: uuid().notNull(),
    branchId: uuid().notNull(),
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: 'staff_branches_pk', columns: [table.authUserId, table.branchId] }),
    index('staff_branches_tenant_idx').on(table.tenantId),
    foreignKey({
      name: 'staff_branches_profile_fk',
      columns: [table.tenantId, table.authUserId],
      foreignColumns: [staffProfiles.tenantId, staffProfiles.authUserId],
    }).onDelete('cascade'),
    tenantIsolationPolicy(),
  ],
);
