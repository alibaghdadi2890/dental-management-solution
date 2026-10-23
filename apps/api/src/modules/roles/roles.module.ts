import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { RoleTemplatesService } from './application/role-templates.service';
import { RolesService } from './application/roles.service';
import { PlatformRoleTemplatesController } from './http/platform-role-templates.controller';
import { RolesController } from './http/roles.controller';
import { RoleTemplatesRepository } from './persistence/role-templates.repository';
import { RolesRepository } from './persistence/roles.repository';

/** See docs/modules/roles.md. */
@Module({
  imports: [AuditModule],
  controllers: [RolesController, PlatformRoleTemplatesController],
  providers: [RolesService, RolesRepository, RoleTemplatesService, RoleTemplatesRepository],
  exports: [RolesService],
})
export class RolesModule {}
