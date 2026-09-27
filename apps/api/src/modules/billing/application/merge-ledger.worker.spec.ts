import { type Job, UnrecoverableError } from 'bullmq';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { AppClsStore } from '../../../platform/cls/app-cls-store';
import { RequestContext } from '../../../platform/cls/request-context';
import type { DeadLetters } from '../../../platform/queue/dead-letters';
import type { BillingService } from './billing.service';
import { MergeLedgerWorker } from './merge-ledger.worker';

const TENANT = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const KEPT = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';
const DROPPED = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());

function setup() {
  const billing = { repointMergedEntries: vi.fn(() => Promise.resolve(2)) };
  const deadLetters = { record: vi.fn(() => Promise.resolve()) };
  const worker = new MergeLedgerWorker(
    context,
    deadLetters as unknown as DeadLetters,
    billing as unknown as BillingService,
  );
  return { worker, billing, deadLetters };
}

function job(name: string, payload: unknown = { keptId: KEPT, droppedId: DROPPED }): Job {
  return {
    id: `${TENANT}_merge_${DROPPED}`,
    name,
    queueName: 'billing',
    data: { tenantId: TENANT, requestId: 'req-1', payload },
    attemptsMade: 0,
    opts: { attempts: 5 },
  } as unknown as Job;
}

describe('MergeLedgerWorker', () => {
  it('re-points the entries as a job actor in the job tenant', async () => {
    const { worker, billing } = setup();
    let actor: { kind: string | undefined; tenantId: string | undefined } | undefined;
    billing.repointMergedEntries.mockImplementation(() => {
      actor = { kind: context.actorKind, tenantId: context.tenantId };
      return Promise.resolve(2);
    });

    await expect(worker.process(job('merge-ledger'))).resolves.toEqual({ moved: 2 });
    expect(billing.repointMergedEntries).toHaveBeenCalledWith(KEPT, DROPPED);
    expect(actor).toEqual({ kind: 'job', tenantId: TENANT });
  });

  it('refuses an unknown job name as unrecoverable, and dead-letters it', async () => {
    const { worker, billing, deadLetters } = setup();
    await expect(worker.process(job('something-else'))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(billing.repointMergedEntries).not.toHaveBeenCalled();
    expect(deadLetters.record).toHaveBeenCalledOnce();
  });

  it('refuses a malformed payload as unrecoverable', async () => {
    const { worker, billing } = setup();
    await expect(worker.process(job('merge-ledger', { keptId: 'nope' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(billing.repointMergedEntries).not.toHaveBeenCalled();
  });
});
