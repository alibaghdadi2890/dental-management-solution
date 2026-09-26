import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

export const DEAD_LETTER_QUEUE = 'dead-letter';

/** Jobs that exhausted their retries (or can never succeed) land here for monitoring and replay. */
@Injectable()
export class DeadLetters {
  private readonly logger = new Logger(DeadLetters.name);

  constructor(@InjectQueue(DEAD_LETTER_QUEUE) private readonly queue: Queue) {}

  async record(job: Job, error: unknown): Promise<void> {
    this.logger.error(
      { err: error, queue: job.queueName, jobName: job.name, jobId: job.id },
      'job dead-lettered',
    );
    await this.queue.add(
      'dead-letter',
      {
        queue: job.queueName,
        name: job.name,
        jobId: job.id,
        data: job.data as unknown,
        reason: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString(),
      },
      { jobId: `${job.queueName}_${job.id ?? 'unknown'}`, removeOnComplete: false },
    );
  }
}
