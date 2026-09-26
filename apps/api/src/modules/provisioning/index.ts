// Public API of the provisioning module (CLAUDE.md §4). Nothing may depend on this module; the
// index exists for AppModule and for event consumers.
export { ProvisioningModule } from './provisioning.module';
export { TENANT_PROVISIONED, type TenantProvisioned } from './events/tenant-provisioned';
