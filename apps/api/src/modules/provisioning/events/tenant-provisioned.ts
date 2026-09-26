import type { DomainEvent } from '../../../platform/events/domain-event';

export const TENANT_PROVISIONED = 'TenantProvisioned';

/** A clinic is ready: tenant, organization mirror, first branch (and, from step C, owner and roles). */
export type TenantProvisioned = DomainEvent<
  typeof TENANT_PROVISIONED,
  { tenantId: string; firstBranchId: string }
>;
