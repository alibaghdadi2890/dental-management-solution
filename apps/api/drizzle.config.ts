import { defineConfig } from 'drizzle-kit';

// Each module owns its tables in modules/<name>/persistence/schema.ts (CLAUDE.md §7).
// Migrations run as the schema owner, never as the runtime role.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/persistence/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? '' },
});
