import type { Job, Queue } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppClsStore } from '../cls/app-cls-store';
import { MissingTenantContextError, RequestContext } from '../cls/request-context';
import { newId } from '../kernel/id';
import type { DeadLetters } from './dead-letters';
import { TenantJobs } from './tenant-jobs';
import { TenantWorker } from './tenant-worker';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
const TENANT = newId();

describe('TenantJobs.enqueue', () => {
  const queue = () => ({ add: vi.fn(() => Promise.resolve()) });

  it('refuses to enqueue without a tenant', async () => {
    const jobs = new TenantJobs(context);
    await expect(
      jobs.enqueue(queue() as unknown as Queue, 'send', {}, { jobId: 'x' }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
  });

  it('stamps tenant, request and actor, with a deterministic tenant-scoped job id', async () => {
    const jobs = new TenantJobs(context);
    const fake = queue();

    await context.run(
      { requestId: 'req-00000001', actorKind: 'user', tenantId: TENANT, userId: 'u1' },
      () =>
        jobs.enqueue(
          fake as unknown as Queue,
          'send-reminder',
          { appointmentId: 'a1' },
          {
            jobId: 'reminder_a1',
          },
        ),
    );

    expect(fake.add).toHaveBeenCalledWith(
      'send-reminder',
      {
        tenantId: TENANT,
        requestId: 'req-00000001',
        actorUserId: 'u1',
        payload: { appointmentId: 'a1' },
      },
      expect.objectContaining({ jobId: `${TENANT}_reminder_a1`, attempts: 5 }),
    );
  });
});

class ReminderWorker extends TenantWorker<{ appointmentId: string }> {
  protected readonly payloadSchema = z.object({ appointmentId: z.string() });
  readonly handled: { tenantId: string | undefined; actorKind: string | undefined }[] = [];
  failWith: Error | undefined;

  protected handle(): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.handled.push({ tenantId: this.context.tenantId, actorKind: this.context.actorKind });
    return Promise.resolve();
  }
}

function job(data: unknown, attemptsMade = 0): Job {
  return {
    id: '1',
    name: 'send-reminder',
    queueName: 'reminders',
    data,
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job;
}

function worker() {
  const deadLetters = { record: vi.fn(() => Promise.resolve()) };
  return {
    worker: new ReminderWorker(context, deadLetters as unknown as DeadLetters),
    deadLetters,
  };
}

describe('TenantWorker', () => {
  const envelope = { tenantId: TENANT, requestId: 'req-1', payload: { appointmentId: 'a1' } };

  it('runs the handler inside the job tenant context', async () => {
    const { worker: w } = worker();
    await w.process(job(envelope));
    expect(w.handled).toEqual([{ tenantId: TENANT, actorKind: 'job' }]);
  });

  it('fails loudly and dead-letters jobs without a tenant', async () => {
    const { worker: w, deadLetters } = worker();
    await expect(w.process(job({ payload: { appointmentId: 'a1' } }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(w.handled).toEqual([]);
    expect(deadLetters.record).toHaveBeenCalledOnce();
  });

  it('rejects invalid payloads without retrying', async () => {
    const { worker: w } = worker();
    await expect(w.process(job({ ...envelope, payload: {} }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('dead-letters only after the final attempt', async () => {
    const { worker: w, deadLetters } = worker();
    w.failWith = new Error('SMS provider down');

    await expect(w.process(job(envelope, 0))).rejects.toThrow('SMS provider down');
    expect(deadLetters.record).not.toHaveBeenCalled();

    await expect(w.process(job(envelope, 2))).rejects.toThrow('SMS provider down');
    expect(deadLetters.record).toHaveBeenCalledOnce();
  });
});
