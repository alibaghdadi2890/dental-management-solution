import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { PlanNotOpenError, RecordNotFoundError } from '../domain/visit-errors';
import { visitServices } from './schema';

type VisitServiceRow = typeof visitServices.$inferSelect;

/** A `visit_services` row as the application sees it (RLS supplies the tenant). */
export type StoredVisitService = Omit<VisitServiceRow, 'tenantId'>;

export type NewVisitService = Pick<
  StoredVisitService,
  | 'visitId'
  | 'procedureId'
  | 'code'
  | 'name'
  | 'category'
  | 'chargeUnit'
  | 'toothCode'
  | 'surfaces'
  | 'baseAmount'
  | 'planId'
  | 'recordedBy'
>;

/** A price edit (W6) or the soft delete. */
export type VisitServicePatch = Partial<
  Pick<StoredVisitService, 'baseAmount' | 'discountAmount' | 'deletedAt'>
>;

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

  /**
   * A service of this visit that isn't removed, `FOR UPDATE` in the caller's transaction; else
   * 404 `record.not_found`.
   */
  lockInVisit(id: string, visitId: string): Promise<StoredVisitService> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(visitServices)
        .where(
          and(
            eq(visitServices.id, id),
            eq(visitServices.visitId, visitId),
            isNull(visitServices.deletedAt),
          ),
        )
        .for('update');
      if (!row) throw new RecordNotFoundError('Service not found in this visit');
      return toStored(row);
    });
  }

  /**
   * A plan is performed by at most one live service (`visit_services_plan_unique`): a second
   * perform that races past the plan's row lock → 409 `plan.not_open`.
   */
  async insert(service: NewVisitService): Promise<StoredVisitService> {
    try {
      const [row] = await this.db.run((tx) => tx.insert(visitServices).values(service).returning());
      if (!row) throw new Error('visit service insert returned no row');
      return toStored(row);
    } catch (error) {
      if (isUniqueViolation(error, 'visit_services_plan_unique')) {
        throw new PlanNotOpenError('This plan has already been performed');
      }
      throw error;
    }
  }

  async update(id: string, patch: VisitServicePatch): Promise<StoredVisitService> {
    const [row] = await this.db.run((tx) =>
      tx.update(visitServices).set(patch).where(eq(visitServices.id, id)).returning(),
    );
    if (!row) throw new RecordNotFoundError('Service not found');
    return toStored(row);
  }
}
