import type {
  Branch,
  BranchCreate,
  BranchPatch,
  PlatformTenantQuery,
  Room,
  RoomBatch,
  Tenant,
  TenantSettingsPatch,
  TenantStatus,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { PlatformAdminDb } from '../../../platform/db/platform-admin-db';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { EventBus } from '../../../platform/events/event-bus';
import { newId } from '../../../platform/kernel/id';
import { AuditService } from '../../audit';
import { assertUniqueRooms } from '../domain/room-batch';
import {
  BranchNotFoundError,
  RoomBranchChangeError,
  RoomNotFoundError,
  TenantNotFoundError,
  TenantSlugTakenError,
} from '../domain/tenancy-errors';
import { TENANT_CURRENCY_CHANGED, type TenantCurrencyChanged } from '../events/tenant-events';
import { BranchesRepository } from '../persistence/branches.repository';
import { RoomsRepository } from '../persistence/rooms.repository';
import { type NewTenant, TenantsRepository } from '../persistence/tenants.repository';

/**
 * Tenants, branches and rooms (docs/modules/tenancy.md). Tenant creation and listing are the only
 * cross-tenant operations (`withoutTenant()`, platform admins); everything else runs inside the
 * current tenant under RLS. Every mutation re-checks its permission and is audited in the same
 * transaction.
 */
@Injectable()
export class TenancyService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly adminDb: PlatformAdminDb,
    private readonly audit: AuditService,
    private readonly tenants: TenantsRepository,
    private readonly branches: BranchesRepository,
    private readonly rooms: RoomsRepository,
    private readonly events: EventBus,
  ) {}

  // --- Platform administration (cross-tenant) ---

  async createTenant(tenant: NewTenant): Promise<Tenant> {
    this.context.requirePermission('platform:admin');
    try {
      return await this.adminDb.withoutTenant('provision tenant', (tx) =>
        this.tenants.insert(tx, tenant),
      );
    } catch (error) {
      if (isUniqueViolation(error, 'tenants_slug_unique')) {
        throw new TenantSlugTakenError(
          `The slug "${tenant.slug}" is already used by another clinic`,
        );
      }
      throw error;
    }
  }

  /** Compensation for a provisioning that failed after the tenant row committed. */
  async discardTenant(id: string): Promise<void> {
    this.context.requirePermission('platform:admin');
    await this.adminDb.withoutTenant('discard failed provisioning', (tx) =>
      this.tenants.delete(tx, id),
    );
  }

  async listTenants(query: PlatformTenantQuery): Promise<(Tenant & { branchCount: number })[]> {
    this.context.requirePermission('platform:admin');
    return this.adminDb.withoutTenant('list tenants', (tx) =>
      this.tenants.listWithBranchCounts(tx, query),
    );
  }

  // --- The current tenant ---

  /**
   * The tenant in context. Not permission-gated here: every member sees their clinic's name and
   * settings in the session; `GET /tenant` still requires `tenant:read`.
   */
  currentTenant(): Promise<Tenant> {
    return this.requireCurrent();
  }

  /**
   * For the session guard, before permissions are resolved: status of the tenant in context, or
   * null when it does not exist. Exposes nothing beyond the status.
   */
  async currentTenantStatus(): Promise<TenantStatus | null> {
    return (await this.tenants.current())?.status ?? null;
  }

  /**
   * A currency change is announced inside the transaction: a module that holds money in the old
   * currency refuses it by throwing (422 `tenant.currency_locked`, ADR-0035).
   */
  async updateSettings(patch: TenantSettingsPatch): Promise<Tenant> {
    this.context.requirePermission('tenant:write');
    return this.tenantDb.run(async () => {
      const before = await this.requireCurrent();
      const after = await this.tenants.update(before.id, patch);
      if (after.currency !== before.currency) {
        await this.events.publish(
          this.events.create(TENANT_CURRENCY_CHANGED, {
            from: before.currency,
            to: after.currency,
          }) satisfies TenantCurrencyChanged,
        );
      }
      await this.audit.record({
        action: 'tenant.update',
        resourceType: 'tenant',
        resourceId: after.id,
        before,
        after,
      });
      return after;
    });
  }

  async setStatus(status: TenantStatus, reason: string): Promise<Tenant> {
    this.context.requirePermission('platform:admin');
    return this.tenantDb.run(async () => {
      const before = await this.requireCurrent();
      const after = await this.tenants.update(before.id, { status });
      await this.audit.record({
        action: status === 'suspended' ? 'tenant.suspend' : 'tenant.reactivate',
        resourceType: 'tenant',
        resourceId: after.id,
        before: { status: before.status },
        after: { status: after.status },
        reason,
      });
      return after;
    });
  }

  // --- Branches ---

  listBranches(): Promise<Branch[]> {
    this.context.requirePermission('tenant:read');
    return this.branches.list();
  }

  /** Active branches among `ids`, in no particular order; for session and staff assignment. */
  activeBranches(ids: readonly string[]): Promise<Branch[]> {
    return this.branches.byIds(ids, { activeOnly: true });
  }

  /** Branches among `ids` whatever their status, in no particular order; for staff records. */
  branchesByIds(ids: readonly string[]): Promise<Branch[]> {
    return this.branches.byIds(ids);
  }

  /** Every active branch of the tenant, oldest first. */
  async allActiveBranches(): Promise<Branch[]> {
    return (await this.branches.list()).filter((branch) => branch.active);
  }

  async createBranch(input: BranchCreate): Promise<Branch> {
    this.context.requirePermission('tenant:write');
    return this.tenantDb.run(async () => {
      const branch = await this.branches.insert(input);
      await this.audit.record({
        action: 'branch.create',
        resourceType: 'branch',
        resourceId: branch.id,
        after: branch,
      });
      return branch;
    });
  }

  /** Includes (de)activation: branches are never deleted. */
  async updateBranch(id: string, patch: BranchPatch): Promise<Branch> {
    this.context.requirePermission('tenant:write');
    return this.tenantDb.run(async () => {
      const before = await this.branches.byId(id);
      if (!before) {
        throw new BranchNotFoundError('Branch not found');
      }
      const after = await this.branches.update(id, patch);
      await this.audit.record({
        action: 'branch.update',
        resourceType: 'branch',
        resourceId: id,
        before,
        after,
      });
      return after;
    });
  }

  // --- Rooms ---

  listRooms(branchId?: string): Promise<Room[]> {
    this.context.requirePermission('tenant:read');
    return this.rooms.list(branchId);
  }

  /**
   * Saves the Catalog-style batch (new rooms have no id) atomically. Rooms are deactivated, never
   * deleted, and never move between branches. Returns the saved rooms.
   */
  async saveRooms(batch: RoomBatch): Promise<Room[]> {
    this.context.requirePermission('tenant:write');
    return this.tenantDb.run(async () => {
      const existing = new Map((await this.rooms.list()).map((room) => [room.id, room]));
      const knownBranches = new Set((await this.branches.list()).map((branch) => branch.id));

      const changes: Room[] = batch.items.map((item) => {
        if (item.id === undefined) {
          if (!knownBranches.has(item.branchId)) {
            throw new BranchNotFoundError('Branch not found');
          }
          return { ...item, id: newId() };
        }
        const current = existing.get(item.id);
        if (!current) {
          throw new RoomNotFoundError('Room not found');
        }
        if (current.branchId !== item.branchId) {
          throw new RoomBranchChangeError('A room cannot move to another branch');
        }
        return { ...item, id: item.id };
      });

      assertUniqueRooms([...existing.values()], changes);
      await this.rooms.save(changes, new Set(existing.keys()));

      for (const room of changes) {
        const before = existing.get(room.id);
        await this.audit.record({
          action: before ? 'room.update' : 'room.create',
          resourceType: 'room',
          resourceId: room.id,
          before,
          after: room,
        });
      }
      return changes;
    });
  }

  private async requireCurrent(): Promise<Tenant> {
    const tenant = await this.tenants.current();
    if (!tenant) {
      throw new TenantNotFoundError('Tenant not found');
    }
    return tenant;
  }
}
