import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { z } from 'zod';
import { RequestContext } from '../cls/request-context';
import { newId } from '../kernel/id';

/** Every job carries its tenant so the worker can re-establish context (CLAUDE.md §5, §9). */
export const tenantJobEnvelopeSchema = z.object({
  tenantId: z.uuid(),
  requestId: z.string().min(1),
  actorUserId: z.string().optional(),
  payload: z.unknown(),
});

export type TenantJobEnvelope = z.infer<typeof tenantJobEnvelopeSchema>;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: false,
} satisfies JobsOptions;

export interface EnqueueOptions {
  /** Deterministic id derived from the work (e.g. `reminder_<appointmentId>`), for idempotency. */
  jobId: string;
  delay?: number;
}

@Injectable()
export class TenantJobs {
  constructor(private readonly context: RequestContext) {}

  async enqueue(
    queue: Queue,
    name: string,
    payload: unknown,
    options: EnqueueOptions,
  ): Promise<void> {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.userId;
    const envelope: TenantJobEnvelope = {
      tenantId,
      requestId: this.context.requestId ?? newId(),
      ...(userId === undefined ? {} : { actorUserId: userId }),
      payload,
    };
    await queue.add(name, envelope, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: `${tenantId}_${options.jobId}`,
      ...(options.delay === undefined ? {} : { delay: options.delay }),
    });
  }
}
