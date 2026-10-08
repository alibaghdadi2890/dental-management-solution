import { Module } from '@nestjs/common';
import { AuditModule } from './modules/audit';
import { AuthModule } from './modules/auth';
import { AuthorizationModule } from './modules/authorization';
import { BillingModule } from './modules/billing';
import { ClinicalModule } from './modules/clinical';
import { FilesModule } from './modules/files';
import { ImportsModule } from './modules/imports';
import { PatientsModule } from './modules/patients';
import { ProvisioningModule } from './modules/provisioning';
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

/** Platform modules every request needs (CLAUDE.md §4 rule 6: infrastructure only). */
export const CORE_PLATFORM_MODULES = [
  ConfigModule,
  ClockModule,
  AppClsModule,
  LoggingModule,
  HttpPlatformModule,
  DbModule,
  EventsModule,
];

/** Redis and the BullMQ queues built on it; integration tests import this (with their own key prefix). */
export const QUEUE_PLATFORM_MODULES = [RedisModule, QueueModule];

/** Platform modules that reach other external services (S3); integration tests leave them out. */
export const EXTERNAL_PLATFORM_MODULES = [StorageModule, HealthModule];

/** Domain modules (phase 1). */
export const DOMAIN_MODULES = [
  TenancyModule,
  AuthModule,
  UsersModule,
  RolesModule,
  AuthorizationModule,
  AuditModule,
  PatientsModule,
  BillingModule,
  ClinicalModule,
  FilesModule,
  ImportsModule,
  ProvisioningModule,
];

/** Every module the app wires up, in one list so nothing (e.g. a route-access audit) can drift. */
export const APP_IMPORTS = [
  ...CORE_PLATFORM_MODULES,
  ...QUEUE_PLATFORM_MODULES,
  ...EXTERNAL_PLATFORM_MODULES,
  ...DOMAIN_MODULES,
];

@Module({
  imports: APP_IMPORTS,
})
export class AppModule {}
