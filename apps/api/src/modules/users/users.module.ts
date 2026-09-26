import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { AuthModule } from '../auth';
import { RolesModule } from '../roles';
import { TenancyModule } from '../tenancy';
import { SessionService } from './application/session.service';
import { UsersService } from './application/users.service';
import { SessionReadController } from './http/session-read.controller';
import { UsersController } from './http/users.controller';
import { StaffRepository } from './persistence/staff.repository';

/** See docs/modules/users.md. */
@Module({
  imports: [AuditModule, AuthModule, RolesModule, TenancyModule],
  controllers: [SessionReadController, UsersController],
  providers: [SessionService, UsersService, StaffRepository],
  exports: [UsersService],
})
export class UsersModule {}
