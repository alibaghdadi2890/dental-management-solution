import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_TENANT_SQL,
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from './columns';

const dialect = new PgDialect();

describe('tenant table helpers', () => {
  const probe = pgTable(
    'probe',
    { id: idColumn(), tenantId: tenantIdColumn(), label: text().notNull(), ...timestamps() },
    () => [tenantIsolationPolicy()],
  );

  it('isolates rows by the transaction tenant for reads and writes', () => {
    const [policy] = getTableConfig(probe).policies;
    const expected = `tenant_id = ${CURRENT_TENANT_SQL}`;

    expect(policy?.name).toBe('tenant_isolation');
    expect(policy?.for).toBe('all');
    expect(dialect.sqlToQuery(policy!.using!).sql).toBe(expected);
    expect(dialect.sqlToQuery(policy!.withCheck!).sql).toBe(expected);
  });

  it('treats an unset tenant as NULL so nothing matches', () => {
    expect(CURRENT_TENANT_SQL).toBe("nullif(current_setting('app.tenant_id', true), '')::uuid");
  });

  it('generates uuid v7 ids in the application', () => {
    const id = probe.id.defaultFn?.();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });
});
