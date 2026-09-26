import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenancyService } from './application/tenancy.service';
import { BranchesController } from './http/branches.controller';
import { RoomsController } from './http/rooms.controller';
import { TenantController } from './http/tenant.controller';
import { BranchesRepository } from './persistence/branches.repository';
import { RoomsRepository } from './persistence/rooms.repository';
import { TenantsRepository } from './persistence/tenants.repository';

/** See docs/modules/tenancy.md. */
@Module({
  imports: [AuditModule],
  controllers: [TenantController, BranchesController, RoomsController],
  providers: [TenancyService, TenantsRepository, BranchesRepository, RoomsRepository],
  exports: [TenancyService],
})
export class TenancyModule {}
