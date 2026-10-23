import { randomBytes } from 'node:crypto';
import {
  closeImplied,
  CUSTOM_ROLE_KEY_PREFIX,
  type GrantablePermission,
  type Permission,
  type Role,
  type RoleCreate,
  type RoleRef,
  type RoleUpdate,
  type SystemRoleKey,
  type UserGrantsUpdate,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { AuditService } from '../../audit';
import {
  assertCanAssign,
  assertCanGrant,
  assertCanManage,
  assertCanRemove,
  assertDeactivatable,
  assertEditable,
  assertNoSelfLockout,
  type Editor,
} from '../domain/role-rules';
import { RoleKindError, RoleNotFoundError, UnknownRoleError } from '../domain/roles-errors';
import { SYSTEM_ROLES, systemRole } from '../domain/system-roles';
import {
  type RoleDefinition,
  type RoleRow,
  RolesRepository,
} from '../persistence/roles.repository';
import { RoleTemplatesService } from './role-templates.service';

const OWNER: SystemRoleKey = 'owner';

const sortedKeys = (refs: readonly RoleRef[]) => refs.map((ref) => ref.key).sort();

const newCustomKey = () => `${CUSTOM_ROLE_KEY_PREFIX}${randomBytes(4).toString('hex')}`;

/**
 * What roles exist in the tenant, who holds them and which extra permissions a user has
 * (docs/modules/roles.md, ADR-0055). Users are the global auth user id (ADR-0009). Every change
 * needs `role:write`, follows the rules of `role-rules.ts` — the editor only gives what they hold,
 * never locks themselves out, never edits `owner` — and is audited in the same transaction. The
 * reads below are the building blocks `users` and `authorization` guard.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly roles: RolesRepository,
    private readonly templates: RoleTemplatesService,
  ) {}

  /**
   * Creates the missing roles a new clinic starts with (A5, ADR-0056): the system roles with the
   * platform's default permissions (`owner` with everything) and every active extra default role
   * as a custom role. A no-op for the roles that exist.
   */
  async seedSystemRoles(): Promise<void> {
    this.context.requirePermission('role:write');
    await this.tenantDb.run(async () => {
      const templates = await this.templates.forTenant();
      const definitions: RoleDefinition[] = [
        ...SYSTEM_ROLES.map((role) => ({
          key: role.key,
          name: role.name,
          system: true,
          permissions:
            templates.find((template) => template.system && template.key === role.key)
              ?.permissions ?? role.permissions,
        })),
        ...templates
          .filter((template) => !template.system && template.active)
          .map((template) => ({
            key: template.key,
            name: template.name,
            description: template.description,
            system: false,
            permissions: template.permissions,
          })),
      ];
      const created = await this.roles.insertMissing(definitions);
      for (const role of created) {
        await this.audit.record({
          action: 'role.create',
          resourceType: 'role',
          resourceId: role.id,
          after: {
            key: role.key,
            name: role.name,
            system: role.system,
            permissions: definitions.find((definition) => definition.key === role.key)?.permissions,
          },
        });
      }
    });
  }

  listRoles(): Promise<Role[]> {
    this.context.requirePermission('role:read');
    return this.roles.list();
  }

  /** A custom role, empty or a copy of another role's permissions (`copyFrom`, a role key). */
  async createRole(input: RoleCreate): Promise<Role> {
    this.context.requirePermission('role:write');
    return this.tenantDb.run(async () => {
      let permissions: GrantablePermission[] = [];
      if (input.copyFrom !== undefined) {
        const [source] = await this.roles.byKeys([input.copyFrom]);
        if (!source) throw new UnknownRoleError(`Unknown role: ${input.copyFrom}`);
        permissions = await this.roles.permissionsOfRole(source.id);
      }
      permissions = closeImplied(permissions);
      assertCanGrant(await this.editor(), [], permissions);
      const role = await this.roles.insertCustom({
        key: newCustomKey(),
        name: input.name,
        description: input.description,
        permissions,
        createdBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'role.create',
        resourceType: 'role',
        resourceId: role.id,
        after: { key: role.key, name: role.name, description: role.description, permissions },
      });
      return this.present(role.id);
    });
  }

  /**
   * A role's name and description (custom roles only) and permissions (any role but `owner`). The
   * permissions are the whole new set, closed under `implies`.
   */
  async updateRole(id: string, patch: RoleUpdate): Promise<Role> {
    this.context.requirePermission('role:write');
    return this.tenantDb.run(async () => {
      const role = await this.load(id);
      assertEditable(role);
      if (role.system && (patch.name !== undefined || patch.description !== undefined)) {
        throw new RoleKindError('A system role keeps its name');
      }
      const before = await this.roles.permissionsOfRole(id);
      const after = patch.permissions === undefined ? before : closeImplied(patch.permissions);
      const callerBefore = await this.callerPermissions();
      const editor = await this.editor();
      assertCanGrant(editor, before, after);
      await this.assertCanNarrow(editor, role, before, after);

      const details = {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
      };
      await this.roles.update(id, { ...details, updatedBy: this.context.requireUserId() });
      if (patch.permissions !== undefined) {
        await this.roles.replacePermissions(id, after);
      }
      await this.assertCallerKeepsAccess(callerBefore);
      await this.audit.record({
        action: 'role.update',
        resourceType: 'role',
        resourceId: id,
        before: { name: role.name, description: role.description, permissions: before },
        after: {
          name: details.name ?? role.name,
          description: details.description === undefined ? role.description : details.description,
          permissions: after,
        },
      });
      return this.present(id);
    });
  }

  /** A custom role nobody holds is switched off: it grants nothing and cannot be assigned. */
  async deactivateRole(id: string): Promise<Role> {
    this.context.requirePermission('role:write');
    return this.tenantDb.run(async () => {
      const role = await this.loadCustom(id);
      if (role.active) {
        assertDeactivatable(await this.roles.holderCount(id));
        await this.roles.update(id, { active: false, updatedBy: this.context.requireUserId() });
        await this.recordActive(role, false);
      }
      return this.present(id);
    });
  }

  async reactivateRole(id: string): Promise<Role> {
    this.context.requirePermission('role:write');
    return this.tenantDb.run(async () => {
      const role = await this.loadCustom(id);
      if (!role.active) {
        await this.roles.update(id, { active: true, updatedBy: this.context.requireUserId() });
        await this.recordActive(role, true);
      }
      return this.present(id);
    });
  }

  /** A system role (but `owner`) back to the platform's default for it (ADR-0055, ADR-0056). */
  async resetToDefault(id: string): Promise<Role> {
    this.context.requirePermission('role:write');
    return this.tenantDb.run(async () => {
      const role = await this.load(id);
      assertEditable(role);
      const key = role.key as SystemRoleKey;
      if (!role.system) throw new RoleKindError('Only a system role has a default');
      const before = await this.roles.permissionsOfRole(id);
      const template = (await this.templates.forTenant()).find(
        (candidate) => candidate.system && candidate.key === key,
      );
      const after = template?.permissions ?? [...systemRole(key).permissions];
      const callerBefore = await this.callerPermissions();
      const editor = await this.editor();
      assertCanGrant(editor, before, after);
      await this.assertCanNarrow(editor, role, before, after);
      await this.roles.replacePermissions(id, after);
      await this.roles.update(id, { updatedBy: this.context.requireUserId() });
      await this.assertCallerKeepsAccess(callerBefore);
      await this.audit.record({
        action: 'role.reset',
        resourceType: 'role',
        resourceId: id,
        before: { permissions: before },
        after: { permissions: after },
      });
      return this.present(id);
    });
  }

  /** Roles held by each user; users without roles map to an empty list. */
  rolesFor(userIds: readonly string[]): Promise<Map<string, RoleRef[]>> {
    return this.roles.assignmentsOf(userIds);
  }

  /** Per-user additional permissions; users without any map to an empty list. */
  grantsFor(userIds: readonly string[]): Promise<Map<string, GrantablePermission[]>> {
    return this.roles.grantsOf(userIds);
  }

  /**
   * Replaces the user's role set. Unknown or inactive keys are refused as a whole
   * (`role.unknown`); a role the editor could not grant permission by permission is refused
   * (`role.cannot_grant`), and only an owner or a platform admin hands out `owner`.
   */
  async assignRoles(userId: string, roleKeys: readonly string[]): Promise<RoleRef[]> {
    this.context.requirePermission('role:write');
    return this.tenantDb.run(async () => {
      const wanted = [...new Set(roleKeys)];
      const found = (await this.roles.byKeys(wanted)).filter((role) => role.active);
      const unknown = wanted.filter((key) => !found.some((role) => role.key === key));
      if (unknown.length > 0) {
        throw new UnknownRoleError(`Unknown role: ${unknown.join(', ')}`, { unknown });
      }

      const before = (await this.roles.assignmentsOf([userId])).get(userId) ?? [];
      if (sortedKeys(before).join() === [...wanted].sort().join()) {
        return before;
      }
      const added = found.filter((role) => !before.some((held) => held.key === role.key));
      const removed = before.filter((held) => !found.some((role) => role.key === held.key));
      const editor = await this.editor();
      assertCanRemove(
        editor,
        removed.map((role) => role.key),
      );
      const addedRoles = [];
      for (const role of added) {
        // Sequential: every read joins the same transaction, i.e. one connection.
        addedRoles.push({
          key: role.key,
          permissions: await this.roles.permissionsOfRole(role.id),
        });
      }
      assertCanAssign(editor, addedRoles);
      const callerBefore = await this.callerPermissions();
      await this.roles.replaceAssignments(
        userId,
        found.map((role) => role.id),
      );
      await this.assertCallerKeepsAccess(callerBefore);
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

  /**
   * Replaces the user's additional permissions (ADR-0055), closed under `implies`. The caller
   * checks the user exists in the tenant (`UsersService.setGrants`).
   */
  async setGrants(userId: string, input: UserGrantsUpdate): Promise<GrantablePermission[]> {
    this.context.requirePermission('role:write');
    return this.tenantDb.run(async () => {
      const before = (await this.roles.grantsOf([userId])).get(userId) ?? [];
      const after = closeImplied(input.permissions);
      if ([...before].sort().join() === [...after].sort().join()) {
        return before;
      }
      assertCanGrant(await this.editor(), before, after);
      const callerBefore = await this.callerPermissions();
      await this.roles.replaceGrants(userId, after, {
        grantedBy: this.context.requireUserId(),
        reason: input.reason ?? null,
      });
      await this.assertCallerKeepsAccess(callerBefore);
      await this.audit.record({
        action: 'user.grants_update',
        resourceType: 'user',
        resourceId: userId,
        before: { grants: before },
        after: { grants: after },
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      });
      return after;
    });
  }

  /**
   * Before changing someone's account (`users`): the caller must hold everything they hold, and
   * only an owner or a platform admin manages an owner (403 `role.cannot_manage`, ADR-0055).
   */
  async assertCanManage(userId: string): Promise<void> {
    if (userId === this.context.userId) return;
    const editor = await this.editor();
    if (editor.holdsAll) return;
    assertCanManage(editor, {
      owner: (await this.roles.holdersOf(OWNER)).includes(userId),
      permissions: await this.roles.permissionsOf(userId),
    });
  }

  /**
   * Taking permissions from a role changes its holders' access: the editor must be able to
   * manage each of them, as for a change to their own roles (ADR-0055). The caller's own access is
   * the self-lockout rule's.
   */
  private async assertCanNarrow(
    editor: Editor,
    role: RoleRow,
    before: readonly GrantablePermission[],
    after: readonly GrantablePermission[],
  ): Promise<void> {
    if (editor.holdsAll) return;
    const kept = new Set(after);
    if (before.every((permission) => kept.has(permission))) return;
    const owners = await this.roles.holdersOf(OWNER);
    for (const holder of await this.roles.holdersOf(role.key)) {
      if (holder === this.context.userId) continue;
      assertCanManage(editor, {
        owner: owners.includes(holder),
        permissions: await this.roles.permissionsOf(holder),
      });
    }
  }

  /** Roles and grants: what `authorization` puts in the context (ADR-0010, ADR-0055). */
  permissionsForUser(userId: string): Promise<Permission[]> {
    return this.roles.permissionsOf(userId);
  }

  /** Users holding the role, e.g. the owners for the last-owner rule. */
  holdersOf(roleKey: string): Promise<string[]> {
    return this.roles.holdersOf(roleKey);
  }

  /**
   * Who is editing: an owner, a platform admin in their own request or a system task holds every
   * permission; anyone else what their roles and grants give.
   */
  private async editor(): Promise<Editor> {
    const permissions = new Set(this.context.grantedPermissions());
    if (this.context.actsAsPlatformAdmin || this.context.actorKind === 'system') {
      return { holdsAll: true, permissions };
    }
    const userId = this.context.userId;
    const owner = userId !== undefined && (await this.roles.holdersOf(OWNER)).includes(userId);
    return { holdsAll: owner, permissions };
  }

  /** The caller's own permissions as stored, before a change; null for a platform admin or a
   * system task, whose authority does not come from roles. */
  private async callerPermissions(): Promise<Set<Permission> | null> {
    const userId = this.context.userId;
    if (userId === undefined || this.context.actsAsPlatformAdmin) return null;
    if (this.context.actorKind === 'system') return null;
    return new Set(await this.roles.permissionsOf(userId));
  }

  /** Read back inside the transaction after the write: a lockout throws and rolls it back. */
  private async assertCallerKeepsAccess(before: Set<Permission> | null): Promise<void> {
    const userId = this.context.userId;
    if (before === null || userId === undefined) return;
    assertNoSelfLockout(before, new Set(await this.roles.permissionsOf(userId)));
  }

  private async load(id: string): Promise<RoleRow> {
    const role = await this.roles.byId(id);
    if (!role) throw new RoleNotFoundError('Role not found');
    return role;
  }

  private async loadCustom(id: string): Promise<RoleRow> {
    const role = await this.load(id);
    if (role.system) throw new RoleKindError('Only a custom role is switched off');
    return role;
  }

  private async present(id: string): Promise<Role> {
    const role = (await this.roles.list()).find((candidate) => candidate.id === id);
    if (!role) throw new RoleNotFoundError('Role not found');
    return role;
  }

  private async recordActive(role: RoleRow, active: boolean): Promise<void> {
    await this.audit.record({
      action: active ? 'role.reactivate' : 'role.deactivate',
      resourceType: 'role',
      resourceId: role.id,
      before: { name: role.name, active: !active },
      after: { name: role.name, active },
    });
  }
}
