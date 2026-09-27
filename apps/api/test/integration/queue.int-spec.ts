import { BullModule, getQueueToken, Processor } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { QUEUE_PLATFORM_MODULES } from '../../src/app.module';
import { AppClsModule } from '../../src/platform/cls/cls.module';
import { RequestContext } from '../../src/platform/cls/request-context';
import { APP_CONFIG, ConfigModule } from '../../src/platform/config/config.module';
import { newId } from '../../src/platform/kernel/id';
import { TenantJobs } from '../../src/platform/queue/tenant-jobs';
import { TenantWorker } from '../../src/platform/queue/tenant-worker';
import { testConfig } from '../support/test-config';

const PROBE_QUEUE = `test-probe-${newId()}`;
const probePayloadSchema = z.object({ marker: z.string() });

interface Delivery {
  tenantId: string | undefined;
  actorKind: string | undefined;
  requestId: string | undefined;
  userId: string | undefined;
}

/** Throwaway processor: records what the tenant envelope carried into `handle()` for each job. */
@Processor(PROBE_QUEUE)
class ProbeWorker extends TenantWorker<z.infer<typeof probePayloadSchema>> {
  protected readonly payloadSchema = probePayloadSchema;
  readonly deliveries: Delivery[] = [];

  protected handle(): Promise<void> {
    this.deliveries.push({
      tenantId: this.context.tenantId,
      actorKind: this.context.actorKind,
      requestId: this.context.requestId,
      userId: this.context.userId,
    });
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
    const config = testConfig({ QUEUE_PREFIX: `test-${newId()}` });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        AppClsModule,
        ...QUEUE_PLATFORM_MODULES,
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

  it('round-trips the tenant envelope through Redis with a tenant-prefixed jobId, and dedupes repeated enqueues', async () => {
    const tenantId = newId();
    const userId = newId();
    const requestId = `req-${newId()}`;
    const jobId = `probe-${newId()}`;
    const enqueue = () =>
      context.run({ requestId, actorKind: 'user', tenantId, userId }, () =>
        tenantJobs.enqueue(probeQueue, 'probe', { marker: 'hello' }, { jobId }),
      );

    // Same jobId twice: BullMQ dedupes by id, so the handler must run exactly once (CLAUDE.md §9).
    await enqueue();
    await enqueue();

    await vi.waitFor(
      () => {
        expect(probeWorker.deliveries).toHaveLength(1);
      },
      { timeout: 10_000 },
    );
    expect(probeWorker.deliveries).toEqual([{ tenantId, actorKind: 'job', requestId, userId }]);

    // Confirm against Redis itself, not just the handler side, that BullMQ only ever queued and
    // completed one job for the shared id (no second job snuck in behind the dedupe).
    await vi.waitFor(
      async () => {
        const counts = await probeQueue.getJobCounts(
          'waiting',
          'delayed',
          'active',
          'completed',
          'failed',
        );
        // `getJobCounts` always echoes a `paused` count too; check only the states we asked for.
        expect(counts).toMatchObject({
          waiting: 0,
          delayed: 0,
          active: 0,
          completed: 1,
          failed: 0,
        });
      },
      { timeout: 10_000 },
    );
  });
});
