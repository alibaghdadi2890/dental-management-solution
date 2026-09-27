import { idSchema } from '@dcm/contracts';
import { Processor } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { RequestContext } from '../../../platform/cls/request-context';
import { DeadLetters } from '../../../platform/queue/dead-letters';
import { TenantWorker } from '../../../platform/queue/tenant-worker';
import { BillingService } from './billing.service';

/** `billing`'s BullMQ queue (registered in `billing.module.ts`). */
export const BILLING_QUEUE = 'billing';

/** Moves a merged-away patient's ledger entries to the kept patient (design Q9). */
export const MERGE_LEDGER_JOB = 'merge-ledger';

export const mergeLedgerPayloadSchema = z.object({ keptId: idSchema, droppedId: idSchema });
export type MergeLedgerPayload = z.infer<typeof mergeLedgerPayloadSchema>;

/**
 * Runs `merge-ledger` jobs in the job's tenant as a `job` actor (`TenantWorker`; the merging user
 * stays the audit's actor user). Retried with backoff, then dead-lettered (CLAUDE.md §9). The
 * re-point is idempotent, so a retry after a partial failure — or a replayed dead letter — is
 * safe.
 */
@Processor(BILLING_QUEUE)
export class MergeLedgerWorker extends TenantWorker<MergeLedgerPayload> {
  protected readonly payloadSchema = mergeLedgerPayloadSchema;

  constructor(
    context: RequestContext,
    deadLetters: DeadLetters,
    private readonly billing: BillingService,
  ) {
    super(context, deadLetters);
  }

  protected async handle(payload: MergeLedgerPayload, job: Job): Promise<{ moved: number }> {
    if (job.name !== MERGE_LEDGER_JOB) {
      throw new UnrecoverableError(`Unknown ${BILLING_QUEUE} job "${job.name}"`);
    }
    return { moved: await this.billing.repointMergedEntries(payload.keptId, payload.droppedId) };
  }
}
