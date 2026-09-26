import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { RolesService } from './application/roles.service';
import { RolesController } from './http/roles.controller';
import { RolesRepository } from './persistence/roles.repository';

/** See docs/modules/roles.md. */
@Module({
  imports: [AuditModule],
  controllers: [RolesController],
  providers: [RolesService, RolesRepository],
  exports: [RolesService],
})
export class RolesModule {}
