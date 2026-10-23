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

/**
 * Roles of a tenant: the seeded system roles (D4) and the clinic's custom ones (`system = false`,
 * ADR-0055). A custom role is deactivated, never deleted: inactive, it grants nothing.
 */
export const roles = pgTable(
  'roles',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    system: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    /** The auth user id of the last edit; null for a role never edited since it was seeded. */
    updatedBy: uuid(),
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

/**
 * Per-user additional permissions (ADR-0055), on top of the user's roles; additive only, no
 * denies. Catalog strings, validated on read like `role_permissions`. Revoked = hard-deleted.
 */
export const userPermissionGrants = pgTable(
  'user_permission_grants',
  {
    tenantId: tenantIdColumn(),
    /** The global auth user id (ADR-0009). */
    userId: uuid().notNull(),
    permission: text().notNull(),
    /** The auth user id who granted it. */
    grantedBy: uuid().notNull(),
    reason: text(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      name: 'user_permission_grants_pk',
      columns: [table.tenantId, table.userId, table.permission],
    }),
    index('user_permission_grants_tenant_idx').on(table.tenantId),
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

/**
 * The platform's default roles (ADR-0056): global, no `tenant_id` and no RLS. Every tenant
 * transaction reads them (provisioning seeds a clinic from them; Reset to default restores a
 * system role to its template); only `withoutTenant()` writes them — migration 0051 revokes
 * writes from the runtime role. `owner` is no template: it holds every permission by rule.
 */
export const roleTemplates = pgTable('role_templates', {
  id: idColumn(),
  key: text().notNull().unique('role_templates_key_unique'),
  name: text().notNull(),
  description: text(),
  /** Dentist, assistant, front desk: a clinic's system role of that key resets to it. */
  system: boolean().notNull().default(false),
  /** An inactive extra template is not given to new clinics. */
  active: boolean().notNull().default(true),
  /** The auth user id of the platform admin who last changed it. */
  updatedBy: uuid(),
  ...timestamps(),
});

/** Template → permission (catalog strings, validated on read). Junction: hard delete. */
export const roleTemplatePermissions = pgTable(
  'role_template_permissions',
  {
    templateId: uuid()
      .notNull()
      .references(() => roleTemplates.id, { onDelete: 'cascade' }),
    permission: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      name: 'role_template_permissions_pk',
      columns: [table.templateId, table.permission],
    }),
  ],
);
