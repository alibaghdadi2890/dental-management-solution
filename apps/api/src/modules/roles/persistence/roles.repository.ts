import {
  GRANTABLE_PERMISSIONS,
  type GrantablePermission,
  isPermission,
  type Permission,
  type Role,
  type RoleRef,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { newId } from '../../../platform/kernel/id';
import { rolePermissions, roles, userPermissionGrants, userRoles } from './schema';

export interface RoleDefinition {
  key: string;
  name: string;
  description?: string | null;
  system: boolean;
  permissions: readonly Permission[];
}

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  system: boolean;
  active: boolean;
}

/** Permission text written by earlier versions may leave the catalog; it then grants nothing.
 * `platform:admin` is never granted by a role or a grant (ADR-0008). */
const grantableOnly = (values: readonly string[]): GrantablePermission[] =>
  values.filter(
    (value): value is GrantablePermission => isPermission(value) && value !== 'platform:admin',
  );

const OWNER = 'owner';

const roleColumns = {
  id: roles.id,
  key: roles.key,
  name: roles.name,
  description: roles.description,
  system: roles.system,
  active: roles.active,
};

/** Roles, their permissions, user assignments and per-user grants of the current tenant (RLS). */
@Injectable()
export class RolesRepository {
  constructor(private readonly db: TenantDb) {}

  list(): Promise<Role[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select(roleColumns)
        .from(roles)
        .orderBy(asc(roles.createdAt), asc(roles.id));
      const grants = await tx
        .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
        .from(rolePermissions)
        .orderBy(asc(rolePermissions.permission));
      const holders = await tx
        .select({ roleId: userRoles.roleId, n: count() })
        .from(userRoles)
        .groupBy(userRoles.roleId);
      return rows.map((row) => ({
        ...row,
        permissions: grantableOnly(
          grants.filter((grant) => grant.roleId === row.id).map((grant) => grant.permission),
        ),
        holders: holders.find((holder) => holder.roleId === row.id)?.n ?? 0,
      }));
    });
  }

  async byId(id: string): Promise<RoleRow | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select(roleColumns).from(roles).where(eq(roles.id, id)),
    );
    return row;
  }

  byKeys(keys: readonly string[]): Promise<RoleRow[]> {
    if (keys.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select(roleColumns)
        .from(roles)
        .where(inArray(roles.key, [...keys])),
    );
  }

  async permissionsOfRole(roleId: string): Promise<GrantablePermission[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId)),
    );
    return grantableOnly(rows.map((row) => row.permission));
  }

  async holderCount(roleId: string): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx.select({ n: count() }).from(userRoles).where(eq(userRoles.roleId, roleId)),
    );
    return row?.n ?? 0;
  }

  /** Inserts the roles that do not exist yet (by key) with their permissions; returns those. */
  insertMissing(definitions: readonly RoleDefinition[]): Promise<RoleRow[]> {
    return this.db.run(async (tx) => {
      const created = await tx
        .insert(roles)
        .values(
          definitions.map((definition) => ({
            id: newId(),
            key: definition.key,
            name: definition.name,
            description: definition.description ?? null,
            system: definition.system,
          })),
        )
        .onConflictDoNothing({ target: [roles.tenantId, roles.key] })
        .returning(roleColumns);

      const grants = created.flatMap((role) =>
        (definitions.find((definition) => definition.key === role.key)?.permissions ?? []).map(
          (permission) => ({ roleId: role.id, permission }),
        ),
      );
      if (grants.length > 0) {
        await tx.insert(rolePermissions).values(grants);
      }
      return created;
    });
  }

  /** A custom role with its permissions. */
  async insertCustom(role: {
    key: string;
    name: string;
    description: string | null;
    permissions: readonly GrantablePermission[];
    createdBy: string;
  }): Promise<RoleRow> {
    return this.db.run(async (tx) => {
      const [created] = await tx
        .insert(roles)
        .values({
          id: newId(),
          key: role.key,
          name: role.name,
          description: role.description,
          system: false,
          updatedBy: role.createdBy,
        })
        .returning(roleColumns);
      if (!created) throw new Error('Role insert returned no row');
      if (role.permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(role.permissions.map((permission) => ({ roleId: created.id, permission })));
      }
      return created;
    });
  }

  update(
    id: string,
    change: { name?: string; description?: string | null; active?: boolean; updatedBy: string },
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.update(roles).set(change).where(eq(roles.id, id));
    });
  }

  replacePermissions(roleId: string, permissions: readonly GrantablePermission[]): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(permissions.map((permission) => ({ roleId, permission })));
      }
    });
  }

  /** Role refs per user, in role order. */
  async assignmentsOf(userIds: readonly string[]): Promise<Map<string, RoleRef[]>> {
    const result = new Map<string, RoleRef[]>(userIds.map((id) => [id, []]));
    if (userIds.length === 0) return result;
    const rows = await this.db.run((tx) =>
      tx
        .select({ userId: userRoles.userId, key: roles.key, name: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(userRoles.userId, [...userIds]))
        .orderBy(asc(roles.createdAt), asc(roles.id)),
    );
    for (const row of rows) {
      result.get(row.userId)?.push({ key: row.key, name: row.name });
    }
    return result;
  }

  replaceAssignments(userId: string, roleIds: readonly string[]): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      if (roleIds.length > 0) {
        await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
      }
    });
  }

  /** Per-user grants, in catalog order; users without any map to an empty list. */
  async grantsOf(userIds: readonly string[]): Promise<Map<string, GrantablePermission[]>> {
    const result = new Map<string, GrantablePermission[]>(userIds.map((id) => [id, []]));
    if (userIds.length === 0) return result;
    const rows = await this.db.run((tx) =>
      tx
        .select({
          userId: userPermissionGrants.userId,
          permission: userPermissionGrants.permission,
        })
        .from(userPermissionGrants)
        .where(inArray(userPermissionGrants.userId, [...userIds])),
    );
    for (const [userId, granted] of result) {
      const own = new Set(rows.filter((row) => row.userId === userId).map((row) => row.permission));
      granted.push(...GRANTABLE_PERMISSIONS.filter((permission) => own.has(permission)));
    }
    return result;
  }

  replaceGrants(
    userId: string,
    permissions: readonly GrantablePermission[],
    grant: { grantedBy: string; reason: string | null },
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.delete(userPermissionGrants).where(eq(userPermissionGrants.userId, userId));
      if (permissions.length > 0) {
        await tx
          .insert(userPermissionGrants)
          .values(permissions.map((permission) => ({ userId, permission, ...grant })));
      }
    });
  }

  /**
   * What a user may do (ADR-0055): the permissions of their active roles and their grants. A
   * holder of `owner` holds every grantable permission by rule, so a permission added to the
   * catalog later needs no migration to reach owners.
   */
  async permissionsOf(userId: string): Promise<GrantablePermission[]> {
    return this.db.run(async (tx) => {
      // One row per active role held (with each of its permissions, if any).
      const held = await tx
        .select({
          key: roles.key,
          system: roles.system,
          permission: rolePermissions.permission,
        })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(and(eq(userRoles.userId, userId), eq(roles.active, true)));
      if (held.some((row) => row.system && row.key === OWNER)) {
        return [...GRANTABLE_PERMISSIONS];
      }
      const granted = await tx
        .select({ permission: userPermissionGrants.permission })
        .from(userPermissionGrants)
        .where(eq(userPermissionGrants.userId, userId));
      const all = new Set([...held, ...granted].map((row) => row.permission));
      return GRANTABLE_PERMISSIONS.filter((permission) => all.has(permission));
    });
  }

  async holdersOf(key: string): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(roles.key, key)),
    );
    return rows.map((row) => row.userId);
  }
}
