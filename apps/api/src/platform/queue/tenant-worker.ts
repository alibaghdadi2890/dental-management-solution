import { WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import type { z } from 'zod';
import { RequestContext } from '../cls/request-context';
import { DeadLetters } from './dead-letters';
import { tenantJobEnvelopeSchema } from './tenant-jobs';

/**
 * Base for every BullMQ processor. Re-establishes the tenant context from the job before any work
 * and fails loudly (no retries) when the job has no tenant (CLAUDE.md §5). Subclasses are
 * decorated with `@Processor(queueName)` and implement `handle()`; they inherit the constructor.
 */
@Injectable()
export abstract class TenantWorker<TPayload> extends WorkerHost {
  protected abstract readonly payloadSchema: z.ZodType<TPayload>;

  constructor(
    protected readonly context: RequestContext,
    private readonly deadLetters: DeadLetters,
  ) {
    super();
  }

  protected abstract handle(payload: TPayload, job: Job): Promise<unknown>;

  async process(job: Job): Promise<unknown> {
    try {
      const envelope = tenantJobEnvelopeSchema.safeParse(job.data);
      if (!envelope.success) {
        throw new UnrecoverableError(`${describe(job)} has no valid tenant context`);
      }
      const payload = this.payloadSchema.safeParse(envelope.data.payload);
      if (!payload.success) {
        throw new UnrecoverableError(`${describe(job)} has an invalid payload`);
      }
      const { tenantId, requestId, actorUserId } = envelope.data;
      return await this.context.run(
        {
          requestId,
          actorKind: 'job',
          tenantId,
          ...(actorUserId === undefined ? {} : { userId: actorUserId }),
        },
        () => this.handle(payload.data, job),
      );
    } catch (error) {
      if (error instanceof UnrecoverableError || isLastAttempt(job)) {
        await this.deadLetters.record(job, error);
      }
      throw error;
    }
  }
}

function describe(job: Job): string {
  return `Job ${job.queueName}/${job.name}#${job.id ?? '?'}`;
}

function isLastAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}
