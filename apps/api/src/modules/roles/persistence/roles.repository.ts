import { isPermission, type Permission, type Role, type RoleRef } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { newId } from '../../../platform/kernel/id';
import { rolePermissions, roles, userRoles } from './schema';

export interface RoleDefinition {
  key: string;
  name: string;
  system: boolean;
  permissions: readonly Permission[];
}

export interface RoleRow {
  id: string;
  key: string;
  name: string;
}

/** Permission text written by earlier versions may leave the catalog; it then grants nothing. */
const catalogOnly = (values: readonly string[]): Permission[] => values.filter(isPermission);

/** Roles, their permissions and user assignments of the current tenant (RLS). */
@Injectable()
export class RolesRepository {
  constructor(private readonly db: TenantDb) {}

  list(): Promise<Role[]> {
    return this.db.run(async (tx) => {
      const rows = await tx.select().from(roles).orderBy(asc(roles.createdAt), asc(roles.id));
      const grants = await tx
        .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
        .from(rolePermissions)
        .orderBy(asc(rolePermissions.permission));
      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        system: row.system,
        permissions: catalogOnly(
          grants.filter((grant) => grant.roleId === row.id).map((grant) => grant.permission),
        ),
      }));
    });
  }

  byKeys(keys: readonly string[]): Promise<RoleRow[]> {
    if (keys.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select({ id: roles.id, key: roles.key, name: roles.name })
        .from(roles)
        .where(inArray(roles.key, [...keys])),
    );
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
            system: definition.system,
          })),
        )
        .onConflictDoNothing({ target: [roles.tenantId, roles.key] })
        .returning({ id: roles.id, key: roles.key, name: roles.name });

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

  async permissionsOf(userId: string): Promise<Permission[]> {
    const rows = await this.db.run((tx) =>
      tx
        .selectDistinct({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId))
        .where(eq(userRoles.userId, userId)),
    );
    return catalogOnly(rows.map((row) => row.permission));
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
