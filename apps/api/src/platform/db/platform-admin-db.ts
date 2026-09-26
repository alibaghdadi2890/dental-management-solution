import { Inject, Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../cls/request-context';
import { DomainError } from '../kernel/domain-error';
import { ADMIN_DB, type Database, type Transaction } from './database';

export class PlatformAccessDeniedError extends DomainError {
  readonly code = 'platform.access_denied';
  readonly kind = 'forbidden';
}

/**
 * Cross-tenant access for platform administration (tenant provisioning) and system tasks.
 * Deliberately grep-able: every call site of `withoutTenant(` is a place RLS does not protect.
 */
@Injectable()
export class PlatformAdminDb {
  private readonly logger = new Logger(PlatformAdminDb.name);

  constructor(
    @Inject(ADMIN_DB) private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  async withoutTenant<T>(reason: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    if (!this.context.isPlatformAdmin && this.context.actorKind !== 'system') {
      throw new PlatformAccessDeniedError('Cross-tenant access requires platform:admin');
    }
    this.logger.warn({ reason, actorKind: this.context.actorKind }, 'cross-tenant access');
    return this.db.transaction(work);
  }
}
