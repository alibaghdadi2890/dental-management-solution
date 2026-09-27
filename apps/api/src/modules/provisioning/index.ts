// Public API of the provisioning module (CLAUDE.md §4). Nothing calls this module; the index
// exists for AppModule and for event consumers (ADR-0014).
export { ProvisioningModule } from './provisioning.module';
export { TENANT_PROVISIONED, type TenantProvisioned } from './events/tenant-provisioned';
