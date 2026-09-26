// Public API of the tenancy module. Other modules import from this file only (CLAUDE.md §4).
export { TenancyModule } from './tenancy.module';
export { TenancyService } from './application/tenancy.service';
export { TenantNotFoundError, TenantSuspendedError } from './domain/tenancy-errors';
