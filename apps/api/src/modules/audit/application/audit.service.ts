import type { AuditPage, AuditQuery } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import type { Clock } from '../../../platform/kernel/clock';
import { decodeAuditCursor, encodeAuditCursor } from '../domain/audit-cursor';
import { redactSecrets } from '../domain/redact-secrets';
import { AuditRepository } from '../persistence/audit.repository';

export interface AuditRecord {
  /** Dot-separated verb, e.g. `branch.update`. */
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  /** Why, when the UI asked for a reason (suspend, deactivate, void …). */
  reason?: string | undefined;
}

/**
 * Every mutation through an application service records one entry (CLAUDE.md §10). `record()`
 * joins the caller's open transaction, so the entry commits or rolls back with the change.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly context: RequestContext,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async record(entry: AuditRecord): Promise<void> {
    await this.repository.insert({
      actorUserId: this.context.userId ?? null,
      actorKind: this.context.actorKind ?? 'system',
      actorPlatformAdmin: this.context.isPlatformAdmin,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      before: entry.before === undefined ? null : redactSecrets(entry.before),
      after: entry.after === undefined ? null : redactSecrets(entry.after),
      reason: entry.reason ?? null,
      requestId: this.context.requestId ?? null,
      occurredAt: this.clock.now(),
    });
  }

  async list(query: AuditQuery): Promise<AuditPage> {
    this.context.requirePermission('audit:read');
    const items = await this.repository.list({
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      after: query.cursor === undefined ? undefined : decodeAuditCursor(query.cursor),
      limit: query.limit + 1,
    });
    const page = items.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        items.length > query.limit && last
          ? encodeAuditCursor({ occurredAt: new Date(last.occurredAt), id: last.id })
          : null,
    };
  }
}
