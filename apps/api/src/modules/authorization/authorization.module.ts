import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule, SessionGuard } from '../auth';
import { RolesModule } from '../roles';
import { AuthorizationService } from './application/authorization.service';
import { PermissionGuard } from './http/permission.guard';

/**
 * See docs/modules/authorization.md. Both global guards are registered here, in this order, so
 * authentication always runs before authorization.
 */
@Module({
  imports: [AuthModule, RolesModule],
  providers: [
    AuthorizationService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
