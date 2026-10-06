import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, inArray, isNull } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { PlanNotOpenError, RecordNotFoundError } from '../domain/visit-errors';
import { visits, visitServices } from './schema';

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
  | 'jaw'
  | 'surfaces'
  | 'baseAmount'
  | 'planId'
  | 'recordedBy'
>;

/** A price edit (W6), an amendment's new tooth and surfaces (4b), or the soft delete. */
export type VisitServicePatch = Partial<
  Pick<StoredVisitService, 'baseAmount' | 'discountAmount' | 'toothCode' | 'surfaces' | 'deletedAt'>
>;

/** A service of a finished visit, with the visit facts a history line shows. */
export interface FinishedService {
  service: StoredVisitService;
  visitDate: string;
  dentistId: string;
  currency: string;
}

/** Visits whose services are history: completed, amended and — marked by the caller — voided
 * (D6: a voided visit's treatment stays on the chart). */
const FINISHED_STATUSES = ['completed', 'amended', 'voided'] as const;

function toStored({ tenantId: _tenantId, ...service }: VisitServiceRow): StoredVisitService {
  return service;
}

const { tenantId: _tenantId, ...serviceColumns } = getTableColumns(visitServices);

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

  /** The services of these visits that aren't removed, in the order they were added. */
  listForVisits(visitIds: readonly string[]): Promise<StoredVisitService[]> {
    if (visitIds.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(visitServices)
          .where(
            and(inArray(visitServices.visitId, [...visitIds]), isNull(visitServices.deletedAt)),
          )
          .orderBy(asc(visitServices.createdAt), asc(visitServices.id))
      ).map(toStored),
    );
  }

  /**
   * The services of the patient's finished visits (`FINISHED_STATUSES`) that aren't removed, most
   * recent visit first (then the order they were added in reverse); only one tooth's when
   * `toothCode` is given. Each carries its visit's local date, dentist and currency.
   */
  finishedForPatient(patientId: string, toothCode?: string): Promise<FinishedService[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          ...serviceColumns,
          visitDate: visits.localDate,
          dentistId: visits.dentistId,
          currency: visits.currency,
        })
        .from(visitServices)
        .innerJoin(visits, eq(visits.id, visitServices.visitId))
        .where(
          and(
            eq(visits.patientId, patientId),
            inArray(visits.status, [...FINISHED_STATUSES]),
            toothCode === undefined ? undefined : eq(visitServices.toothCode, toothCode),
            isNull(visitServices.deletedAt),
          ),
        )
        .orderBy(
          desc(visits.completedAt),
          desc(visits.id),
          desc(visitServices.createdAt),
          desc(visitServices.id),
        );
      return rows.map(({ visitDate, dentistId, currency, ...service }) => ({
        service,
        visitDate,
        dentistId,
        currency,
      }));
    });
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
