import type {
  Practitioner,
  StaffUser,
  StaffUserCreate,
  StaffUserPatch,
  SystemRoleKey,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { AuditService } from '../../audit';
import { AuthService } from '../../auth';
import { RolesService } from '../../roles';
import { TenancyService } from '../../tenancy';
import {
  assertAssignments,
  assertKeepsAnOwner,
  assertNotSelf,
  StaffUserNotFoundError,
  UnknownBranchError,
} from '../domain/staff-rules';
import { type StaffProfile, StaffRepository } from '../persistence/staff.repository';

const OWNER: SystemRoleKey = 'owner';

const distinct = (ids: readonly string[]) => [...new Set(ids)];

function toPractitioner(profile: StaffProfile): Practitioner {
  return { userId: profile.authUserId, displayName: profile.displayName, title: profile.title };
}

/**
 * Staff users of the current tenant (docs/modules/users.md): the identity (`auth`), the membership
 * mirror, the profile and branch assignments (here) and roles (`roles`) change together in one
 * transaction. Every mutation re-checks `user:write` and is audited without credentials.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly tenancy: TenancyService,
    private readonly roles: RolesService,
    private readonly staff: StaffRepository,
  ) {}

  list(): Promise<StaffUser[]> {
    this.context.requirePermission('user:read');
    return this.tenantDb.run(async () => this.hydrate(await this.staff.list()));
  }

  get(userId: string): Promise<StaffUser> {
    this.context.requirePermission('user:read');
    return this.tenantDb.run(() => this.load(userId));
  }

  /**
   * Active dentists, ordered by display name. Not permission-gated here: a building block like
   * `TenancyService.activeBranches`, used wherever the app offers "assign a dentist" (feature 3
   * Q2); `GET /users/practitioners` still requires `user:read`.
   */
  listPractitioners(): Promise<Practitioner[]> {
    return this.tenantDb.run(async () => (await this.staff.practitioners()).map(toPractitioner));
  }

  /**
   * Practitioners among `userIds` whatever their current type or active status — for showing the
   * display name of a dentist already assigned to a patient even after they leave or change role.
   */
  practitionersByIds(userIds: readonly string[]): Promise<Practitioner[]> {
    return this.tenantDb.run(async () =>
      (await this.staff.byUserIds(distinct(userIds))).map(toPractitioner),
    );
  }

  /**
   * A new person in this clinic with a temporary password (D6). An email that already has an
   * identity is refused (`user.email_taken`); attaching it instead is the D7 extension point.
   */
  async createStaffUser(input: StaffUserCreate): Promise<StaffUser> {
    this.context.requirePermission('user:write');
    assertAssignments(input);
    const branchIds = distinct(input.branchIds);
    return this.tenantDb.run(async () => {
      await this.assertBranches(branchIds, []);
      const userId = await this.auth.createIdentity({
        name: input.displayName,
        email: input.email,
        temporaryPassword: input.temporaryPassword,
      });
      await this.auth.syncMembership({ userId, branchIds });
      await this.staff.insert({
        authUserId: userId,
        displayName: input.displayName,
        title: input.title,
        practitionerType: input.practitionerType,
        phone: input.phone,
      });
      await this.staff.replaceBranches(userId, branchIds);
      await this.roles.assignRoles(userId, input.roleKeys);

      const user = await this.load(userId);
      await this.audit.record({
        action: 'user.create',
        resourceType: 'user',
        resourceId: userId,
        after: user,
      });
      return user;
    });
  }

  async updateStaffUser(userId: string, patch: StaffUserPatch): Promise<StaffUser> {
    this.context.requirePermission('user:write');
    assertAssignments(patch);
    const { roleKeys, branchIds, ...profile } = patch;
    return this.tenantDb.run(async () => {
      const before = await this.load(userId);
      if (roleKeys) {
        if (!roleKeys.includes(OWNER)) {
          assertKeepsAnOwner(await this.activeOwnerIds(), userId);
        }
        await this.roles.assignRoles(userId, roleKeys);
      }
      if (branchIds) {
        const ids = distinct(branchIds);
        await this.assertBranches(
          ids,
          before.branches.map((branch) => branch.id),
        );
        await this.staff.replaceBranches(userId, ids);
        if (before.active) {
          await this.auth.syncMembership({ userId, branchIds: ids });
        }
      }
      await this.staff.update(userId, profile);

      const after = await this.load(userId);
      await this.audit.record({
        action: 'user.update',
        resourceType: 'user',
        resourceId: userId,
        before,
        after,
      });
      return after;
    });
  }

  /** Signs the user out everywhere and refuses sign-in until reactivated. */
  async deactivate(userId: string, reason: string): Promise<StaffUser> {
    this.context.requirePermission('user:write');
    assertNotSelf(this.context.userId, userId);
    return this.tenantDb.run(async () => {
      const before = await this.load(userId);
      if (!before.active) {
        return before;
      }
      assertKeepsAnOwner(await this.activeOwnerIds(), userId);
      await this.staff.update(userId, { active: false });
      await this.auth.deactivate(userId, reason);
      await this.auth.removeMembership(userId);
      return this.recordStatusChange(userId, 'user.deactivate', reason);
    });
  }

  async reactivate(userId: string, reason: string): Promise<StaffUser> {
    this.context.requirePermission('user:write');
    return this.tenantDb.run(async () => {
      const before = await this.load(userId);
      if (before.active) {
        return before;
      }
      await this.staff.update(userId, { active: true });
      await this.auth.reactivate(userId);
      await this.auth.syncMembership({
        userId,
        branchIds: before.branches.map((branch) => branch.id),
      });
      return this.recordStatusChange(userId, 'user.reactivate', reason);
    });
  }

  /** A new temporary password (D6); the user is signed out and must change it at next sign-in. */
  async resetPassword(userId: string, temporaryPassword: string): Promise<void> {
    this.context.requirePermission('user:write');
    await this.tenantDb.run(async () => {
      await this.load(userId);
      await this.auth.resetPassword(userId, temporaryPassword);
      await this.audit.record({
        action: 'user.reset_password',
        resourceType: 'user',
        resourceId: userId,
        after: { mustChangePassword: true },
      });
    });
  }

  private async recordStatusChange(
    userId: string,
    action: 'user.deactivate' | 'user.reactivate',
    reason: string,
  ): Promise<StaffUser> {
    const after = await this.load(userId);
    await this.audit.record({
      action,
      resourceType: 'user',
      resourceId: userId,
      before: { active: !after.active },
      after: { active: after.active },
      reason,
    });
    return after;
  }

  /** Staff users of this tenant only: another tenant's user is simply not found (RLS). */
  private async load(userId: string): Promise<StaffUser> {
    const profile = await this.staff.byUserId(userId);
    if (!profile) {
      throw new StaffUserNotFoundError('User not found');
    }
    const [user] = await this.hydrate([profile]);
    if (!user) {
      throw new StaffUserNotFoundError('User not found');
    }
    return user;
  }

  private async hydrate(profiles: readonly StaffProfile[]): Promise<StaffUser[]> {
    // Sequential: every read joins the same transaction, i.e. one connection.
    const ids = profiles.map((profile) => profile.authUserId);
    const identities = await this.auth.identitiesOf(ids);
    const roles = await this.roles.rolesFor(ids);
    const assignments = await this.staff.branchIdsOf(ids);
    const branchNames = new Map(
      (await this.tenancy.branchesByIds(distinct([...assignments.values()].flat()))).map(
        (branch) => [branch.id, branch.name],
      ),
    );

    return profiles.flatMap((profile) => {
      const identity = identities.get(profile.authUserId);
      if (!identity) {
        return [];
      }
      return [
        {
          id: profile.authUserId,
          email: identity.email,
          displayName: profile.displayName,
          title: profile.title,
          practitionerType: profile.practitionerType,
          phone: profile.phone,
          active: profile.active,
          roles: roles.get(profile.authUserId) ?? [],
          branches: (assignments.get(profile.authUserId) ?? []).flatMap((id) => {
            const name = branchNames.get(id);
            return name === undefined ? [] : [{ id, name }];
          }),
          createdAt: profile.createdAt.toISOString(),
        },
      ];
    });
  }

  private async activeOwnerIds(): Promise<string[]> {
    const active = new Set(await this.staff.activeUserIds());
    return (await this.roles.holdersOf(OWNER)).filter((userId) => active.has(userId));
  }

  /** New assignments must be active branches of this tenant; kept ones may since be inactive. */
  private async assertBranches(ids: readonly string[], assigned: readonly string[]): Promise<void> {
    const branches = new Map(
      (await this.tenancy.branchesByIds(ids)).map((branch) => [branch.id, branch]),
    );
    for (const id of ids) {
      const branch = branches.get(id);
      if (!branch || (!branch.active && !assigned.includes(id))) {
        throw new UnknownBranchError('Choose active branches of this clinic');
      }
    }
  }
}
