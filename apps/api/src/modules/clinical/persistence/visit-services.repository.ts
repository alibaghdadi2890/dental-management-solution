import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { visitServices } from './schema';

type VisitServiceRow = typeof visitServices.$inferSelect;

/** A `visit_services` row as the application sees it (RLS supplies the tenant). */
export type StoredVisitService = Omit<VisitServiceRow, 'tenantId'>;

function toStored({ tenantId: _tenantId, ...service }: VisitServiceRow): StoredVisitService {
  return service;
}

/** The services performed in the tenant's visits (RLS through `TenantDb`). */
@Injectable()
export class VisitServicesRepository {
  constructor(private readonly db: TenantDb) {}

  /** The visit's services that aren't removed, in the order they were added. */
  listForVisit(visitId: string): Promise<StoredVisitService[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(visitServices)
          .where(and(eq(visitServices.visitId, visitId), isNull(visitServices.deletedAt)))
          .orderBy(asc(visitServices.createdAt), asc(visitServices.id))
      ).map(toStored),
    );
  }
}
