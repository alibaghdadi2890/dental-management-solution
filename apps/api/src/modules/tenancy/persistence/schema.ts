import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  foreignKey,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CURRENT_TENANT_SQL,
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);

/**
 * Clinics. Not tenant-owned (no tenant_id): created and listed by platform admins through
 * `withoutTenant()`. Members read their own row under RLS (`id` = the transaction's tenant).
 */
export const tenants = pgTable(
  'tenants',
  {
    id: idColumn(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    status: tenantStatus().notNull().default('active'),
    timeZone: text().notNull(),
    currency: char({ length: 3 }).notNull(),
    locale: text().notNull(),
    /** ISO 3166-1 alpha-2; drives phone parsing and date order (feature 3 Q3/Q17). */
    country: char({ length: 2 }).notNull().default('LB'),
    ...timestamps(),
  },
  () => [
    pgPolicy('tenant_self', {
      as: 'permissive',
      for: 'all',
      using: sql.raw(`id = ${CURRENT_TENANT_SQL}`),
      withCheck: sql.raw(`id = ${CURRENT_TENANT_SQL}`),
    }),
  ],
);

export const branches = pgTable(
  'branches',
  {
    id: idColumn(),
    tenantId: tenantIdColumn().references(() => tenants.id),
    name: text().notNull(),
    code: text(),
    address: text(),
    phone: text(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index('branches_tenant_idx').on(table.tenantId),
    // Target of the rooms composite foreign key: rooms stay in their branch's tenant.
    unique('branches_tenant_id_unique').on(table.tenantId, table.id),
    uniqueIndex('branches_name_unique').on(table.tenantId, sql`lower(${table.name})`),
    uniqueIndex('branches_code_unique')
      .on(table.tenantId, sql`lower(${table.code})`)
      .where(sql`${table.code} is not null`),
    tenantIsolationPolicy(),
  ],
);

export const rooms = pgTable(
  'rooms',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    branchId: uuid().notNull(),
    name: text().notNull(),
    code: text(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index('rooms_tenant_idx').on(table.tenantId),
    index('rooms_branch_idx').on(table.branchId),
    foreignKey({
      name: 'rooms_branch_fk',
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    uniqueIndex('rooms_name_unique').on(table.branchId, sql`lower(${table.name})`),
    uniqueIndex('rooms_code_unique')
      .on(table.branchId, sql`lower(${table.code})`)
      .where(sql`${table.code} is not null`),
    tenantIsolationPolicy(),
  ],
);
