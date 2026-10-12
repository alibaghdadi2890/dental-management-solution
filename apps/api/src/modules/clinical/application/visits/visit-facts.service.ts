import { lineFinal, type VisitNumber, type VisitStatus } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import { VisitNotFoundError } from '../../domain/visit-errors';
import { VisitServicesRepository } from '../../persistence/visit-services.repository';
import { type VisitRef, VisitsRepository } from '../../persistence/visits.repository';
import { moneyOf } from './visit-mapping';

/** What `billing` charges for a completed visit (`chargeFacts`, ADR-0024), in the visit currency. */
export interface VisitChargeFacts {
  patientId: string;
  currency: string;
  /** The frozen total, after the visit-level discount. */
  total: string;
  /** The visit's tenant-local date: the charge's effective date. */
  localDate: string;
  /** The services that weren't removed, in the order they were added; `amount` = base − line discount. */
  lines: {
    code: string;
    name: string;
    toothCode: string | null;
    surfaces: string[];
    amount: string;
  }[];
}

/** A visit's money and timing, for `billing`'s visit summary (`visitMoney`). */
export interface VisitMoneyFacts {
  visitId: string;
  patientId: string;
  status: VisitStatus;
  currency: string;
  subtotal: string;
  discount: string;
  total: string;
  completedAt: string | null;
  durationMinutes: number | null;
  serviceCount: number;
}

/**
 * What other modules read about visits (docs/modules/clinical.md): `billing`'s charge, labels and
 * summaries, and `files`' visit links. Every method needs `visit:read`.
 */
@Injectable()
export class VisitFactsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly visits: VisitsRepository,
    private readonly services: VisitServicesRepository,
  ) {}

  /**
   * For `billing`'s in-transaction `VisitCompleted` handler (ADR-0024): what to charge for a
   * completed visit. It reads through the open transaction, so it sees the completion that
   * published the event. A visit that isn't completed is a caller bug and throws.
   */
  async chargeFacts(visitId: string): Promise<VisitChargeFacts> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const visit = await this.visits.findById(visitId);
      if (!visit) throw new VisitNotFoundError('Visit not found');
      if (visit.status !== 'completed' || visit.total === null) {
        throw new Error(`visit ${visitId} is not completed`);
      }
      const services = await this.services.listForVisit(visitId);
      return {
        patientId: visit.patientId,
        currency: visit.currency,
        total: visit.total,
        localDate: visit.localDate,
        lines: services.map((service) => ({
          code: service.code,
          name: service.name,
          toothCode: service.toothCode,
          surfaces: service.surfaces,
          amount: lineFinal({ base: service.baseAmount, discount: service.discountAmount }),
        })),
      };
    });
  }

  /**
   * For `billing`'s receipts, histories and statements (feature 5): each visit's display number,
   * local date and type, in no particular order; unknown ids are absent.
   */
  async numbersFor(visitIds: readonly string[]): Promise<VisitNumber[]> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(() => this.visits.numbersFor([...new Set(visitIds)]));
  }

  /**
   * For `files` (feature 8): the patient, number, day, start and status of each visit among
   * `visitIds`, in no particular order; unknown and discarded ids are absent.
   */
  async refsFor(visitIds: readonly string[]): Promise<VisitRef[]> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(() => this.visits.refsFor([...new Set(visitIds)]));
  }

  /**
   * A visit's money (computed while live, frozen once completed) and timing, for `billing`'s
   * visit summary. Unknown or discarded → 404 `visit.not_found`.
   */
  async visitMoney(visitId: string): Promise<VisitMoneyFacts> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const visit = await this.visits.findById(visitId);
      if (!visit) throw new VisitNotFoundError('Visit not found');
      const services = await this.services.listForVisit(visitId);
      const { subtotal, discount, total } = moneyOf(visit, services);
      return {
        visitId,
        patientId: visit.patientId,
        status: visit.status,
        currency: visit.currency,
        subtotal,
        discount,
        total,
        completedAt: visit.completedAt?.toISOString() ?? null,
        durationMinutes: visit.durationMinutes,
        serviceCount: services.length,
      };
    });
  }
}
