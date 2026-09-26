import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { AuthModule } from '../auth';
import { TenancyModule } from '../tenancy';
import { ProvisioningService } from './application/provisioning.service';
import { PlatformTenantsController } from './http/platform-tenants.controller';

/** See docs/modules/provisioning.md. Nothing depends on this module. */
@Module({
  imports: [AuditModule, AuthModule, TenancyModule],
  controllers: [PlatformTenantsController],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
