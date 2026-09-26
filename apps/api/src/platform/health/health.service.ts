import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { APP_DB, type Database } from '../db/database';
import { REDIS } from '../redis/redis.module';

export type CheckStatus = 'up' | 'down';

export interface Readiness {
  status: 'ok' | 'unavailable';
  checks: { database: CheckStatus; redis: CheckStatus };
}

const CHECK_TIMEOUT_MS = 2_000;

async function probe(check: () => Promise<unknown>): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('health check timed out'));
    }, CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async readiness(): Promise<Readiness> {
    const [database, redis] = await Promise.all([
      probe(() => this.db.execute(sql`select 1`)),
      probe(() => this.redis.ping()),
    ]);
    const status = database === 'up' && redis === 'up' ? 'ok' : 'unavailable';
    return { status, checks: { database, redis } };
  }
}
