import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { ADMIN_DB, APP_DB, createDatabase } from './database';
import { PlatformAdminDb } from './platform-admin-db';
import { TenantDb } from './tenant-db';

const APP_POOL = Symbol('APP_POOL');
const ADMIN_POOL = Symbol('ADMIN_POOL');

@Global()
@Module({
  providers: [
    {
      provide: APP_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_MAX }),
    },
    {
      provide: ADMIN_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.DATABASE_ADMIN_URL, max: 2 }),
    },
    { provide: APP_DB, inject: [APP_POOL], useFactory: createDatabase },
    { provide: ADMIN_DB, inject: [ADMIN_POOL], useFactory: createDatabase },
    TenantDb,
    PlatformAdminDb,
  ],
  exports: [APP_DB, TenantDb, PlatformAdminDb],
})
export class DbModule implements OnApplicationShutdown {
  constructor(
    @Inject(APP_POOL) private readonly appPool: Pool,
    @Inject(ADMIN_POOL) private readonly adminPool: Pool,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.appPool.end(), this.adminPool.end()]);
  }
}
