import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { MissingTenantContextError, RequestContext } from '../../../platform/cls/request-context';
import { OnDomainEvent } from '../../../platform/events/event-bus';
import { TenantJobs } from '../../../platform/queue/tenant-jobs';
import { PATIENTS_MERGED, type PatientsMerged } from '../../patients';
import { BILLING_QUEUE, MERGE_LEDGER_JOB, type MergeLedgerPayload } from './merge-ledger.worker';

/**
 * Ledger entries follow a patient merge (design Q9, ADR-0017). `PatientsMerged` is dispatched
 * after the merge commits; this enqueues the re-point as a tenant job (`merge_<droppedId>`: one
 * job per merged-away patient, so a repeated event enqueues nothing new) in the event's own
 * context — tenant, actor, platform-admin flag, request id. The work itself runs in
 * `MergeLedgerWorker`, retried and dead-lettered.
 *
 * The enqueue is not awaited: while Redis is unreachable, ioredis queues commands offline and
 * `queue.add` would not settle, and the after-commit hooks — the merge request and the audit
 * subscriber — would wait for it. A failed enqueue is logged (ids only), never rethrown;
 * ADR-0017 records this after-commit window and its recovery.
 */
@Injectable()
export class MergeLedgerSubscriber {
  private readonly logger = new Logger(MergeLedgerSubscriber.name);

  constructor(
    private readonly context: RequestContext,
    private readonly jobs: TenantJobs,
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue,
  ) {}

  @OnDomainEvent(PATIENTS_MERGED)
  onPatientsMerged(event: PatientsMerged): Promise<void> {
    void this.enqueue(event).catch((error: unknown) => {
      this.logger.error(
        {
          err: error,
          tenantId: event.tenantId,
          keptId: event.payload.keptId,
          droppedId: event.payload.droppedId,
        },
        'enqueueing the ledger re-point after a merge failed',
      );
    });
    return Promise.resolve();
  }

  private async enqueue(event: PatientsMerged): Promise<void> {
    const { keptId, droppedId } = event.payload;
    if (event.tenantId === null) throw new MissingTenantContextError();
    const payload: MergeLedgerPayload = { keptId, droppedId };
    await this.context.run(
      {
        requestId: event.requestId ?? event.id,
        actorKind: event.actor.kind,
        tenantId: event.tenantId,
        ...(event.actor.userId === null ? {} : { userId: event.actor.userId }),
        platformAdmin: event.actor.platformAdmin,
      },
      () =>
        this.jobs.enqueue(this.queue, MERGE_LEDGER_JOB, payload, { jobId: `merge_${droppedId}` }),
    );
  }
}
