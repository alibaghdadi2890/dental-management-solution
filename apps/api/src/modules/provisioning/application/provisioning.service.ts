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
import { TenancyService } from '../../tenancy';
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
  ) {}

  /**
   * 1. the tenant row (the only cross-tenant write, `withoutTenant()`);
   * 2. inside the new tenant, one transaction: organization mirror, first branch, audit entry and
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
          const branch = await this.tenancy.createBranch({
            ...request.firstBranch,
            code: null,
          });
          await this.audit.record({
            action: 'tenant.provision',
            resourceType: 'tenant',
            resourceId: tenant.id,
            after: { tenant, firstBranchId: branch.id },
          });
          const event: TenantProvisioned = this.events.create(TENANT_PROVISIONED, {
            tenantId: tenant.id,
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
