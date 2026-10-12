import {
  type AddServiceInput,
  type ServiceResult,
  toCents,
  type ToothPresenceChange,
  type UpdateServiceInput,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../audit';
import { CatalogItemInactiveError } from '../../domain/catalog-errors';
import { assertCurrency, assertLinePrice, assertTarget } from '../../domain/record-rules';
import {
  type StoredVisitService,
  VisitServicesRepository,
} from '../../persistence/visit-services.repository';
import { CatalogService } from '../catalog/catalog.service';
import { PlanUnperformer } from '../plan/plan-unperformer';
import { toVisitService } from '../visits/visit-mapping';
import { PresenceWriter } from './presence-writer';
import { presenceContextOf, VisitCharting } from './visit-charting';

const SERVICE = 'visit_service';

const priceOf = ({ baseAmount, discountAmount }: StoredVisitService) => ({
  baseAmount,
  discountAmount,
});

/**
 * Today's services of a live visit (docs/modules/clinical.md, Records in a visit): add at the
 * catalog price, edit the line price, remove. Catalog items must be active (422
 * `catalog.inactive`) and are copied as snapshots; every change is audited with before/after.
 */
@Injectable()
export class ServiceChartingService {
  constructor(
    private readonly charting: VisitCharting,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly services: VisitServicesRepository,
    private readonly presence: PresenceWriter,
    private readonly unperformer: PlanUnperformer,
  ) {}

  /** A catalog service at its catalog price, no line discount (W11, W12). */
  async addService(visitId: string, input: AddServiceInput): Promise<ServiceResult> {
    let presenceChange: ToothPresenceChange | null = null;
    const result = await this.charting.run(visitId, async (change) => {
      const { visit, userId } = change;
      const item = await this.catalog.getServiceForRecord(input.procedureId);
      if (!item.active) throw new CatalogItemInactiveError(`${item.name} is inactive`);
      assertTarget(item.chargeUnit, input.toothCode, input.surfaces, input.jaw);
      assertCurrency(visit.currency, item.price.currency);
      const service = await this.services.insert({
        visitId,
        procedureId: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        chargeUnit: item.chargeUnit,
        toothCode: input.toothCode ?? null,
        jaw: input.jaw ?? null,
        surfaces: input.surfaces,
        baseAmount: item.price.amount,
        planId: null,
        recordedBy: userId,
      });
      await this.audit.record({
        action: `${SERVICE}.create`,
        resourceType: SERVICE,
        resourceId: service.id,
        after: service,
      });
      presenceChange = await this.presence.applyService(presenceContextOf(change), service);
      return toVisitService(service, visit.currency);
    });
    return { ...result, presenceChange };
  }

  /**
   * The base price and line discount; last write wins (W6). A discount above the base → 422
   * `validation_failed` at the field that broke it. An unchanged price changes and audits nothing.
   */
  updateService(
    visitId: string,
    serviceId: string,
    input: UpdateServiceInput,
  ): Promise<ServiceResult> {
    return this.charting.run(visitId, async ({ visit }) => {
      const before = await this.services.lockInVisit(serviceId, visitId);
      const price = {
        baseAmount: input.baseAmount ?? before.baseAmount,
        discountAmount: input.discountAmount ?? before.discountAmount,
      };
      assertLinePrice(price, input.discountAmount === undefined ? 'baseAmount' : 'discountAmount');
      if (
        toCents(price.baseAmount) === toCents(before.baseAmount) &&
        toCents(price.discountAmount) === toCents(before.discountAmount)
      ) {
        return toVisitService(before, visit.currency);
      }
      const after = await this.services.update(serviceId, price);
      await this.audit.record({
        action: `${SERVICE}.update`,
        resourceType: SERVICE,
        resourceId: serviceId,
        before: priceOf(before),
        after: priceOf(after),
      });
      return toVisitService(after, visit.currency);
    });
  }

  /**
   * Soft-deletes the service. One that performing a plan created puts the plan back (the Undo of
   * perform, W13), audited as `treatment_plan.unperform`: to `in_progress` when earlier visits
   * worked on it, else to `planned` — work that only this visit worked on goes with its service
   * (`dropWorkStartedHere`), so a removed service never comes back as an unfinished one.
   */
  async removeService(visitId: string, serviceId: string): Promise<ServiceResult> {
    let presenceChange: ToothPresenceChange | null = null;
    const result = await this.charting.run(visitId, async (change) => {
      const { visit, now } = change;
      const before = await this.services.lockInVisit(serviceId, visitId);
      const after = await this.services.update(serviceId, { deletedAt: now });
      await this.audit.record({
        action: `${SERVICE}.delete`,
        resourceType: SERVICE,
        resourceId: serviceId,
        before,
        after: { deletedAt: after.deletedAt },
      });
      // What the service did to its tooth goes with it (H2).
      presenceChange = await this.presence.revertService(serviceId, now);
      if (before.planId !== null) {
        await this.unperformer.unperform(before.planId, visit);
        await this.unperformer.dropWorkStartedHere(before.planId, visit, now);
      }
      return toVisitService(after, visit.currency);
    });
    return { ...result, presenceChange };
  }
}
