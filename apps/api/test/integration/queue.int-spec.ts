import { BullModule, getQueueToken, Processor } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { z } from 'zod';
import { AppClsModule } from '../../src/platform/cls/cls.module';
import { RequestContext } from '../../src/platform/cls/request-context';
import { APP_CONFIG, ConfigModule } from '../../src/platform/config/config.module';
import { loadConfig } from '../../src/platform/config/config.schema';
import { newId } from '../../src/platform/kernel/id';
import { QueueModule } from '../../src/platform/queue/queue.module';
import { TenantJobs } from '../../src/platform/queue/tenant-jobs';
import { TenantWorker } from '../../src/platform/queue/tenant-worker';
import { RedisModule } from '../../src/platform/redis/redis.module';

const PROBE_QUEUE = `test-probe-${newId()}`;
const probePayloadSchema = z.object({ marker: z.string() });

/** Throwaway processor: records the tenant CLS carries into `handle()` for each delivered job. */
@Processor(PROBE_QUEUE)
class ProbeWorker extends TenantWorker<z.infer<typeof probePayloadSchema>> {
  protected readonly payloadSchema = probePayloadSchema;
  readonly observedTenantIds: string[] = [];
  callCount = 0;

  protected handle(): Promise<void> {
    this.callCount += 1;
    this.observedTenantIds.push(this.context.tenantId ?? 'missing');
    return Promise.resolve();
  }
}

describe('integration harness: Redis-backed BullMQ queues', () => {
  let moduleRef: TestingModule;
  let context: RequestContext;
  let tenantJobs: TenantJobs;
  let probeWorker: ProbeWorker;
  let probeQueue: Queue;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://unused/unused',
      DATABASE_ADMIN_URL: 'postgres://unused/unused',
      REDIS_URL: inject('redisUrl'),
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'unused',
      S3_ACCESS_KEY_ID: 'unused',
      S3_SECRET_ACCESS_KEY: 'unused',
      AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      AUTH_BASE_URL: 'http://localhost:5173',
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        AppClsModule,
        RedisModule,
        QueueModule,
        BullModule.registerQueue({ name: PROBE_QUEUE }),
      ],
      providers: [ProbeWorker],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .compile();

    await moduleRef.init();
    context = moduleRef.get(RequestContext);
    tenantJobs = moduleRef.get(TenantJobs);
    probeWorker = moduleRef.get(ProbeWorker);
    probeQueue = moduleRef.get<Queue>(getQueueToken(PROBE_QUEUE));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('delivers a job inside the enqueuing tenant context and runs each job id once', async () => {
    const tenantId = newId();
    const jobId = `probe-${newId()}`;
    const enqueue = () =>
      context.run({ requestId: `req-${newId()}`, actorKind: 'user', tenantId }, () =>
        tenantJobs.enqueue(probeQueue, 'probe', { marker: 'hello' }, { jobId }),
      );

    // Same jobId twice: BullMQ dedupes by id, so the handler must run exactly once (CLAUDE.md §9).
    await enqueue();
    await enqueue();

    await vi.waitFor(
      () => {
        expect(probeWorker.observedTenantIds).toEqual([tenantId]);
      },
      { timeout: 10_000 },
    );

    // Give a would-be second delivery a chance to arrive before asserting it never does.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(probeWorker.callCount).toBe(1);
  });
});
