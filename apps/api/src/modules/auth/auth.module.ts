import { Module } from '@nestjs/common';
import { CLOCK } from '../../platform/clock/clock.module';
import { APP_CONFIG } from '../../platform/config/config.module';
import type { AppConfig } from '../../platform/config/config.schema';
import { APP_DB, type Database } from '../../platform/db/database';
import type { Clock } from '../../platform/kernel/clock';
import { AuditModule } from '../audit';
import { TenancyModule } from '../tenancy';
import { AuthService } from './application/auth.service';
import { BETTER_AUTH, createBetterAuth } from './application/better-auth';
import { BranchResolver } from './application/branch-resolver';
import { SessionActionsService } from './application/session-actions.service';
import { SessionResolver } from './application/session-resolver';
import { SignInService } from './application/sign-in.service';
import { AuthHttpController } from './http/auth-http.controller';
import { SessionController } from './http/session.controller';
import { IdentityDb } from './persistence/identity-db';
import { IdentityRepository } from './persistence/identity.repository';
import { SignInThrottleRepository } from './persistence/sign-in-throttle.repository';

/** See docs/modules/auth.md. */
@Module({
  imports: [AuditModule, TenancyModule],
  controllers: [AuthHttpController, SessionController],
  providers: [
    {
      provide: BETTER_AUTH,
      inject: [APP_DB, APP_CONFIG, CLOCK],
      useFactory: (db: Database, config: AppConfig, clock: Clock) =>
        createBetterAuth({ db, config, clock }),
    },
    IdentityDb,
    IdentityRepository,
    SignInThrottleRepository,
    SignInService,
    SessionResolver,
    BranchResolver,
    SessionActionsService,
    AuthService,
  ],
  // SessionGuard is registered as a global guard by AuthorizationModule (fixed guard order).
  exports: [AuthService, SessionResolver, BranchResolver],
})
export class AuthModule {}
