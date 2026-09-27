import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ClsServiceManager } from 'nestjs-cls';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppClsStore } from '../../../platform/cls/app-cls-store';
import { RequestContext } from '../../../platform/cls/request-context';
import type { TenantJobs } from '../../../platform/queue/tenant-jobs';
import type { PatientsMerged } from '../../patients';
import { MergeLedgerSubscriber } from './merge-ledger.subscriber';

const TENANT = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const KEPT = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';
const DROPPED = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
const queue = {} as Queue;

function event(overrides: Partial<PatientsMerged> = {}): PatientsMerged {
  return {
    id: 'event-1',
    name: 'PatientsMerged',
    occurredAt: '2026-06-10T09:00:00.000Z',
    tenantId: TENANT,
    actor: { userId: 'admin-1', kind: 'user', platformAdmin: true },
    requestId: 'req-1',
    payload: { keptId: KEPT, droppedId: DROPPED },
    ...overrides,
  };
}

function subscriber(enqueue: TenantJobs['enqueue']) {
  const jobs = { enqueue: vi.fn(enqueue) };
  return {
    subscriber: new MergeLedgerSubscriber(context, jobs as unknown as TenantJobs, queue),
    jobs,
  };
}

/** Lets pending promise callbacks (the detached enqueue and its `catch`) run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('MergeLedgerSubscriber', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues the re-point in the event's context, with a deterministic job id", async () => {
    let seen: Record<string, unknown> | undefined;
    const { subscriber: s, jobs } = subscriber(() => {
      seen = {
        tenantId: context.tenantId,
        userId: context.userId,
        platformAdmin: context.isPlatformAdmin,
        requestId: context.requestId,
      };
      return Promise.resolve();
    });

    await s.onPatientsMerged(event());
    await settle();

    expect(jobs.enqueue).toHaveBeenCalledWith(
      queue,
      'merge-ledger',
      { keptId: KEPT, droppedId: DROPPED },
      { jobId: `merge_${DROPPED}` },
    );
    expect(seen).toEqual({
      tenantId: TENANT,
      userId: 'admin-1',
      platformAdmin: true,
      requestId: 'req-1',
    });
  });

  it('does not wait for an enqueue that never settles (Redis unreachable)', async () => {
    const { subscriber: s, jobs } = subscriber(() => new Promise<void>(() => undefined));
    const handled = s.onPatientsMerged(event());
    await expect(
      Promise.race([
        handled.then(() => 'resolved'),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve('blocked');
          }, 50);
        }),
      ]),
    ).resolves.toBe('resolved');
    expect(jobs.enqueue).toHaveBeenCalledOnce();
  });

  it('logs a failed enqueue with ids only, and never throws', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { subscriber: s } = subscriber(() => Promise.reject(new Error('Redis down')));

    await expect(s.onPatientsMerged(event())).resolves.toBeUndefined();
    await settle();

    expect(error).toHaveBeenCalledOnce();
    const [fields] = error.mock.calls[0] ?? [];
    expect(fields).toEqual({
      err: expect.any(Error) as unknown,
      tenantId: TENANT,
      keptId: KEPT,
      droppedId: DROPPED,
    });
  });

  it('logs an event without a tenant instead of enqueueing it', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { subscriber: s, jobs } = subscriber(() => Promise.resolve());

    await expect(s.onPatientsMerged(event({ tenantId: null }))).resolves.toBeUndefined();
    await settle();

    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });
});
