import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      // BullMQ workers require maxRetriesPerRequest: null on shared connections.
      useFactory: (config: AppConfig) =>
        new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }
}
