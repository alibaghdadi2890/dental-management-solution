import type { DomainEvent } from '../../../platform/events/domain-event';

export const TENANT_PROVISIONED = 'TenantProvisioned';

/** A clinic is ready: tenant, organization mirror, system roles, first branch and owner. */
export type TenantProvisioned = DomainEvent<
  typeof TENANT_PROVISIONED,
  { tenantId: string; ownerUserId: string; firstBranchId: string }
>;
