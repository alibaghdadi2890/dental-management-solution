import { AsyncLocalStorage } from 'node:async_hooks';
import { areaOfAction, type AuditPage, type AuditQuery } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import type { Clock } from '../../../platform/kernel/clock';
import { decodeAuditCursor, encodeAuditCursor } from '../domain/audit-cursor';
import { type AuditSubject, subjectOf } from '../domain/audit-subject';
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
  /**
   * The patient and the visit the change is about (H7). Usually left out: they come from the
   * surrounding `about()`, the resource itself, or the snapshots (`subjectOf`).
   */
  patientId?: string | undefined;
  visitId?: string | undefined;
  /**
   * Kept out of the Activity screen: a row that only shadows another one of the same action
   * (the ledger entry of a payment, of a visit charge). It is still in the log.
   */
  hidden?: boolean | undefined;
}

/**
 * Every mutation through an application service records one entry (CLAUDE.md §10). `record()`
 * joins the caller's open transaction, so the entry commits or rolls back with the change.
 */
@Injectable()
export class AuditService {
  private readonly subject = new AsyncLocalStorage<AuditSubject>();

  constructor(
    private readonly repository: AuditRepository,
    private readonly context: RequestContext,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Runs `work` as being about a patient, a visit, or both: every entry recorded inside it
   * (by the caller, or by what it calls) carries them unless it names its own. A service sets it
   * once where it locks the visit or the patient, instead of at every `record()`.
   */
  about<T>(subject: AuditSubject, work: () => Promise<T>): Promise<T> {
    return this.subject.run({ ...this.subject.getStore(), ...subject }, work);
  }

  async record(entry: AuditRecord): Promise<void> {
    await this.repository.insert({
      ...subjectOf(entry, this.subject.getStore() ?? {}),
      area: entry.hidden ? null : areaOfAction(entry.action),
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
      feed: query.feed,
      area: query.area,
      actorUserId: query.actorUserId,
      platformAdmin: query.platformAdmin,
      from: query.from === undefined ? undefined : new Date(query.from),
      patientId: query.patientId,
      visitId: query.visitId,
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
