import type { Permission, Role, RoleRef } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { AuditService } from '../../audit';
import { UnknownRoleError } from '../domain/roles-errors';
import { SYSTEM_ROLES } from '../domain/system-roles';
import { RolesRepository } from '../persistence/roles.repository';

const sortedKeys = (refs: readonly RoleRef[]) => refs.map((ref) => ref.key).sort();

/**
 * What roles exist in the tenant and who holds them (docs/modules/roles.md). Users are the global
 * auth user id (ADR-0009). Mutations re-check their permission and are audited in the same
 * transaction; the reads below are the building blocks `users` and `authorization` guard.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly roles: RolesRepository,
  ) {}

  /** Creates the missing system roles with the D5 matrix; a no-op when they exist (A5). */
  async seedSystemRoles(): Promise<void> {
    this.context.requirePermission('role:write');
    await this.tenantDb.run(async () => {
      const created = await this.roles.insertMissing(
        SYSTEM_ROLES.map((role) => ({ ...role, system: true })),
      );
      for (const role of created) {
        await this.audit.record({
          action: 'role.create',
          resourceType: 'role',
          resourceId: role.id,
          after: {
            key: role.key,
            name: role.name,
            system: true,
            permissions: SYSTEM_ROLES.find((system) => system.key === role.key)?.permissions,
          },
        });
      }
    });
  }

  listRoles(): Promise<Role[]> {
    this.context.requirePermission('role:read');
    return this.roles.list();
  }

  /** Roles held by each user; users without roles map to an empty list. */
  rolesFor(userIds: readonly string[]): Promise<Map<string, RoleRef[]>> {
    return this.roles.assignmentsOf(userIds);
  }

  /** Replaces the user's role set. Unknown keys are refused as a whole (`role.unknown`). */
  async assignRoles(userId: string, roleKeys: readonly string[]): Promise<RoleRef[]> {
    this.context.requirePermission('role:write');
    return this.tenantDb.run(async () => {
      const wanted = [...new Set(roleKeys)];
      const found = await this.roles.byKeys(wanted);
      const unknown = wanted.filter((key) => !found.some((role) => role.key === key));
      if (unknown.length > 0) {
        throw new UnknownRoleError(`Unknown role: ${unknown.join(', ')}`, { unknown });
      }

      const before = (await this.roles.assignmentsOf([userId])).get(userId) ?? [];
      if (sortedKeys(before).join() === [...wanted].sort().join()) {
        return before;
      }
      await this.roles.replaceAssignments(
        userId,
        found.map((role) => role.id),
      );
      const after = (await this.roles.assignmentsOf([userId])).get(userId) ?? [];
      await this.audit.record({
        action: 'user.roles_assign',
        resourceType: 'user',
        resourceId: userId,
        before: { roles: sortedKeys(before) },
        after: { roles: sortedKeys(after) },
      });
      return after;
    });
  }

  /** The union of the user's role permissions: what `authorization` puts in the context. */
  permissionsForUser(userId: string): Promise<Permission[]> {
    return this.roles.permissionsOf(userId);
  }

  /** Users holding the role, e.g. the owners for the last-owner rule. */
  holdersOf(roleKey: string): Promise<string[]> {
    return this.roles.holdersOf(roleKey);
  }
}
