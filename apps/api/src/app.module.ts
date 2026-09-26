import { Module } from '@nestjs/common';
import { AuditModule } from './modules/audit';
import { AuthModule } from './modules/auth';
import { AuthorizationModule } from './modules/authorization';
import { ClinicalModule } from './modules/clinical';
import { ImportsModule } from './modules/imports';
import { PatientsModule } from './modules/patients';
import { RolesModule } from './modules/roles';
import { TenancyModule } from './modules/tenancy';
import { UsersModule } from './modules/users';
import { ClockModule } from './platform/clock/clock.module';
import { AppClsModule } from './platform/cls/cls.module';
import { ConfigModule } from './platform/config/config.module';
import { DbModule } from './platform/db/db.module';
import { EventsModule } from './platform/events/events.module';
import { HealthModule } from './platform/health/health.module';
import { HttpPlatformModule } from './platform/http/http-platform.module';
import { LoggingModule } from './platform/logging/logging.module';
import { QueueModule } from './platform/queue/queue.module';
import { RedisModule } from './platform/redis/redis.module';
import { StorageModule } from './platform/storage/storage.module';

@Module({
  imports: [
    // Platform (infrastructure only — CLAUDE.md §4 rule 6)
    ConfigModule,
    ClockModule,
    AppClsModule,
    LoggingModule,
    HttpPlatformModule,
    DbModule,
    RedisModule,
    EventsModule,
    QueueModule,
    StorageModule,
    HealthModule,
    // Domain modules (phase 1)
    TenancyModule,
    AuthModule,
    UsersModule,
    RolesModule,
    AuthorizationModule,
    AuditModule,
    PatientsModule,
    ClinicalModule,
    ImportsModule,
  ],
})
export class AppModule {}
