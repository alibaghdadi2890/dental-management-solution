import {
  boolean,
  foreignKey,
  index,
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

/** Roles of a tenant: the seeded system roles (D4) and, later, custom ones (`system = false`). */
export const roles = pgTable(
  'roles',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    key: text().notNull(),
    name: text().notNull(),
    system: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    index('roles_tenant_idx').on(table.tenantId),
    unique('roles_tenant_key_unique').on(table.tenantId, table.key),
    // Target of the composite foreign keys below: assignments stay in their role's tenant.
    unique('roles_tenant_id_unique').on(table.tenantId, table.id),
    tenantIsolationPolicy(),
  ],
);

/** Role → permission (catalog strings, validated on read). Junction: hard delete. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: tenantIdColumn(),
    roleId: uuid().notNull(),
    permission: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: 'role_permissions_pk', columns: [table.roleId, table.permission] }),
    index('role_permissions_tenant_idx').on(table.tenantId),
    foreignKey({
      name: 'role_permissions_role_fk',
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    tenantIsolationPolicy(),
  ],
);

/** User → role, keyed by the global auth user id (ADR-0009). Junction: hard delete. */
export const userRoles = pgTable(
  'user_roles',
  {
    tenantId: tenantIdColumn(),
    userId: uuid().notNull(),
    roleId: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: 'user_roles_pk', columns: [table.userId, table.roleId] }),
    index('user_roles_tenant_idx').on(table.tenantId),
    index('user_roles_role_idx').on(table.roleId),
    foreignKey({
      name: 'user_roles_role_fk',
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    tenantIsolationPolicy(),
  ],
);
