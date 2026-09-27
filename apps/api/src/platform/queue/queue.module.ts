import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { REDIS } from '../redis/redis.module';
import { DEAD_LETTER_QUEUE, DeadLetters } from './dead-letters';
import { DEFAULT_JOB_OPTIONS, TenantJobs } from './tenant-jobs';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [REDIS, APP_CONFIG],
      useFactory: (redis: Redis, config: AppConfig) => ({
        connection: redis,
        prefix: config.QUEUE_PREFIX,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: DEAD_LETTER_QUEUE }),
  ],
  providers: [TenantJobs, DeadLetters],
  exports: [TenantJobs, DeadLetters],
})
export class QueueModule {}
