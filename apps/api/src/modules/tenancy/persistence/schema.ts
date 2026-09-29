import { CHART_MODES, CHART_ORIENTATIONS, TENANT_DEFAULTS, TOOTH_NOTATIONS } from '@dcm/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
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
/** Chart detail level (spec, ADR-0021): rendering only, never changes stored chart data. */
export const chartMode = pgEnum('chart_mode', CHART_MODES);
/** Display notation for tooth labels; the stored code is always canonical FDI (ADR-0021). */
export const toothNotation = pgEnum('tooth_notation', TOOTH_NOTATIONS);
/** Which side renders on the screen's right; the chart is never mirrored (ADR-0021, W17). */
export const chartOrientation = pgEnum('chart_orientation', CHART_ORIENTATIONS);

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
    chartMode: chartMode().notNull().default(TENANT_DEFAULTS.chartMode),
    toothNotation: toothNotation().notNull().default(TENANT_DEFAULTS.toothNotation),
    chartOrientation: chartOrientation().notNull().default(TENANT_DEFAULTS.chartOrientation),
    ...timestamps(),
  },
  (table) => [
    pgPolicy('tenant_self', {
      as: 'permissive',
      for: 'all',
      using: sql.raw(`id = ${CURRENT_TENANT_SQL}`),
      withCheck: sql.raw(`id = ${CURRENT_TENANT_SQL}`),
    }),
    // Belt-and-suspenders under `countrySchema` (ISO 3166-1 alpha-2, upper-case): catches any row
    // written outside the Zod boundary (a script, a future migration) rather than trusting it.
    check('tenants_country_format', sql`${table.country} ~ '^[A-Z]{2}$'`),
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
