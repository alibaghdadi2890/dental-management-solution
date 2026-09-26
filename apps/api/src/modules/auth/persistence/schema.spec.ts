import { getAuthTables } from 'better-auth/db';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { betterAuthSchemaOptions } from '../application/better-auth';
import { betterAuthSchema } from './schema';

describe('identity-plane schema', () => {
  // A better-auth upgrade that adds a field fails here, not in production.
  it.each(Object.entries(getAuthTables(betterAuthSchemaOptions)))(
    'has every column better-auth expects for %s',
    (_model, table) => {
      const drizzleTable = betterAuthSchema[table.modelName as keyof typeof betterAuthSchema];
      expect(drizzleTable, table.modelName).toBeDefined();
      expect(getTableName(drizzleTable)).toBe(table.modelName);

      const columns: Record<string, { notNull: boolean } | undefined> =
        getTableColumns(drizzleTable);
      for (const [field, definition] of Object.entries(table.fields)) {
        const column = columns[definition.fieldName ?? field];
        expect(column, `${table.modelName}.${field}`).toBeDefined();
        if (definition.required === true && definition.defaultValue === undefined) {
          expect(column?.notNull, `${table.modelName}.${field} NOT NULL`).toBe(true);
        }
      }
    },
  );
});
