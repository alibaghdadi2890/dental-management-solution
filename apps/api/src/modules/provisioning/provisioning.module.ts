import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { AuthModule } from '../auth';
import { RolesModule } from '../roles';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { ProvisioningService } from './application/provisioning.service';
import { PlatformTenantsController } from './http/platform-tenants.controller';

/** See docs/modules/provisioning.md. Nothing depends on this module. */
@Module({
  imports: [AuditModule, AuthModule, RolesModule, TenancyModule, UsersModule],
  controllers: [PlatformTenantsController],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
