import type {
  PlatformTenant,
  PlatformTenantQuery,
  ProvisionTenantRequest,
  Tenant,
  TenantStatus,
} from '@dcm/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { newId } from '../../../platform/kernel/id';
import { AuditService } from '../../audit';
import { AuthService, EmailTakenError } from '../../auth';
import { RolesService } from '../../roles';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { TENANT_PROVISIONED, type TenantProvisioned } from '../events/tenant-provisioned';

/**
 * Platform back office (ADR-0009): provisions clinics end to end and serves cross-tenant views.
 * Owns no tables; everything goes through the owning modules' services.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly tenancy: TenancyService,
    private readonly roles: RolesService,
    private readonly users: UsersService,
  ) {}

  /**
   * 1. the tenant row (the only cross-tenant write, `withoutTenant()`);
   * 2. inside the new tenant, one transaction: organization mirror, system roles (seeded directly:
   *    the owner needs them, A5), first branch, owner account, audit entry and
   *    `TenantProvisioned` (dispatched after commit);
   * 3. if step 2 fails, the tenant row is removed again — nothing else was committed.
   */
  async provisionTenant(request: ProvisionTenantRequest): Promise<Tenant> {
    this.context.requirePermission('platform:admin');
    if (await this.auth.isEmailTaken(request.owner.email)) {
      throw new EmailTakenError('A user with this email already exists');
    }

    const tenant = await this.tenancy.createTenant({ id: newId(), ...request.clinic });
    try {
      await this.context.runInTenant(tenant.id, () =>
        this.tenantDb.run(async () => {
          await this.auth.syncOrganization(tenant);
          await this.roles.seedSystemRoles();
          const branch = await this.tenancy.createBranch({
            ...request.firstBranch,
            code: null,
          });
          const owner = await this.users.createStaffUser({
            displayName: request.owner.displayName,
            email: request.owner.email,
            title: null,
            practitionerType: request.owner.practitionerType,
            phone: null,
            roleKeys: ['owner'],
            branchIds: [branch.id],
            temporaryPassword: request.owner.temporaryPassword,
          });
          await this.audit.record({
            action: 'tenant.provision',
            resourceType: 'tenant',
            resourceId: tenant.id,
            after: { tenant, firstBranchId: branch.id, ownerUserId: owner.id },
          });
          const event: TenantProvisioned = this.events.create(TENANT_PROVISIONED, {
            tenantId: tenant.id,
            ownerUserId: owner.id,
            firstBranchId: branch.id,
          });
          await this.events.publish(event);
        }),
      );
    } catch (error) {
      this.logger.warn({ tenantId: tenant.id }, 'provisioning failed; discarding the tenant');
      await this.tenancy.discardTenant(tenant.id);
      throw error;
    }
    return tenant;
  }

  async listTenants(query: PlatformTenantQuery): Promise<PlatformTenant[]> {
    this.context.requirePermission('platform:admin');
    const [tenants, members] = await Promise.all([
      this.tenancy.listTenants(query),
      this.auth.memberCountsByTenant(),
    ]);
    return tenants.map((tenant) => ({ ...tenant, userCount: members.get(tenant.id) ?? 0 }));
  }

  /** Suspension is a tenant-scoped write under RLS, audited with the reason (ADR-0008). */
  async setTenantStatus(tenantId: string, status: TenantStatus, reason: string): Promise<Tenant> {
    this.context.requirePermission('platform:admin');
    return this.context.runInTenant(tenantId, () => this.tenancy.setStatus(status, reason));
  }
}
