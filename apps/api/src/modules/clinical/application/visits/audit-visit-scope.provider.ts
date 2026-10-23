import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import { AuditVisitScope } from '../../../audit';
import { VisitsRepository } from '../../persistence/visits.repository';
import { ownedFilter } from './visit-scope';

/**
 * Answers the audit feed's port (ADR-0055): which visits the caller may see, so the Activity
 * screen and a visit's trail never show another dentist's visit to someone who reads only their
 * own.
 */
@Injectable()
export class AuditVisitScopeProvider implements OnModuleInit {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly auditScope: AuditVisitScope,
    private readonly visits: VisitsRepository,
  ) {}

  onModuleInit(): void {
    this.auditScope.register(() => this.visitIdsInScope());
  }

  private async visitIdsInScope(): Promise<readonly string[] | 'all'> {
    const own = ownedFilter(this.context);
    if (own === undefined) return 'all';
    if (own === null) return [];
    return this.tenantDb.run(() => this.visits.idsOwnedBy(own));
  }
}
