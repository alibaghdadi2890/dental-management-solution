import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  deletedAtColumn,
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

/** Stable and not tenant-extendable, hence a Postgres enum (CLAUDE.md §7). */
export const chargeUnit = pgEnum('charge_unit', ['per_tooth', 'per_jaw']);

/**
 * The service catalog ("procedures", ADR-0002). Prices are money in the tenant currency at the
 * time they were set (ADR-0015). Codes are unique among live rows, so a deleted code can return.
 */
export const procedures = pgTable(
  'procedures',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    code: text().notNull(),
    name: text().notNull(),
    category: text(),
    chargeUnit: chargeUnit().notNull(),
    priceAmount: numeric({ precision: 12, scale: 2 }).notNull(),
    priceCurrency: char({ length: 3 }).notNull(),
    frequent: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('procedures_tenant_idx').on(table.tenantId),
    uniqueIndex('procedures_code_unique')
      .on(table.tenantId, sql`lower(${table.code})`)
      .where(sql`${table.deletedAt} is null`),
    check('procedures_price_non_negative', sql`${table.priceAmount} >= 0`),
    tenantIsolationPolicy(),
  ],
);

/** The diagnosis catalog: what dentists record at an examination. No price. */
export const diagnoses = pgTable(
  'diagnoses',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    code: text().notNull(),
    name: text().notNull(),
    category: text(),
    frequent: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('diagnoses_tenant_idx').on(table.tenantId),
    uniqueIndex('diagnoses_code_unique')
      .on(table.tenantId, sql`lower(${table.code})`)
      .where(sql`${table.deletedAt} is null`),
    tenantIsolationPolicy(),
  ],
);
