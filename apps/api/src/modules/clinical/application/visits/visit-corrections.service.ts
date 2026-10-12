import {
  type AmendVisitInput,
  type CheckoutDiscountInput,
  surfacesSchema,
  toothCodeSchema,
  type VisitResult,
  type VoidVisitInput,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import { EventBus } from '../../../../platform/events/event-bus';
import type { Clock } from '../../../../platform/kernel/clock';
import { localDate } from '../../../../platform/kernel/local-date';
import { AuditService } from '../../../audit';
import { TenancyService } from '../../../tenancy';
import { type AmendableService, planAmendment } from '../../domain/visit-amendment';
import {
  VisitCheckoutClosedError,
  VisitNotCompletedError,
  VisitStaleError,
} from '../../domain/visit-errors';
import { correct } from '../../domain/visit-lifecycle';
import {
  VISIT_AMENDED,
  VISIT_VOIDED,
  type VisitAmended,
  type VisitVoided,
} from '../../events/visit-events';
import { VisitAmendmentsRepository } from '../../persistence/visit-amendments.repository';
import {
  type StoredVisitService,
  VisitServicesRepository,
} from '../../persistence/visit-services.repository';
import { type StoredVisit, VisitsRepository } from '../../persistence/visits.repository';
import { PlanUnperformer } from '../plan/plan-unperformer';
import { PresenceWriter } from '../records/presence-writer';
import { VisitLocks } from './visit-locks';
import { VisitPresenter } from './visit-presenter';

/** A stored service as `planAmendment` sees it (the table's CHECKs admit the contract's values). */
const toAmendable = (service: StoredVisitService): AmendableService => ({
  id: service.id,
  code: service.code,
  name: service.name,
  chargeUnit: service.chargeUnit,
  toothCode: service.toothCode === null ? null : toothCodeSchema.parse(service.toothCode),
  jaw: service.jaw,
  surfaces: surfacesSchema.parse(service.surfaces),
  baseAmount: service.baseAmount,
  discountAmount: service.discountAmount,
  planId: service.planId,
});

/** D8: the client's `expectedUpdatedAt` must be the visit's current `updated_at`. */
function assertFresh(visit: StoredVisit, expectedUpdatedAt: string): void {
  if (visit.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new VisitStaleError('The visit changed since you opened it; reload and try again');
  }
}

/**
 * What changes a visit after it was completed (docs/modules/clinical.md, feature 4b): amend, the
 * discount at checkout, closing the checkout, and void. Each re-checks its own permission, runs
 * in one `TenantDb` transaction under the ADR-0023 locks, refuses a stale `expectedUpdatedAt`,
 * is audited, and publishes its event inside the transaction so `billing` follows before commit.
 */
@Injectable()
export class VisitCorrectionsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly visits: VisitsRepository,
    private readonly services: VisitServicesRepository,
    private readonly amendments: VisitAmendmentsRepository,
    private readonly unperformer: PlanUnperformer,
    private readonly presence: PresenceWriter,
    private readonly locks: VisitLocks,
    private readonly presenter: VisitPresenter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Amends a completed (or already amended) visit (4b, D1–D4, ADR-0025) with `visit:amend`: the
   * services that stay may change tooth and surfaces, the others are soft-deleted (a plan one of
   * them performed returns to `planned`, D2), and the visit discount may change; the money is
   * recomputed and frozen again. Locks the patient then the visit (ADR-0023, as `complete`),
   * refuses a stale `expectedUpdatedAt` (409 `visit.stale`), appends a `visit_amendments` row
   * with the before/after snapshots, audits `visit.amend` with the reason, and publishes
   * `VisitAmended` inside the transaction so `billing` posts the delta before commit.
   */
  async amend(id: string, input: AmendVisitInput): Promise<VisitResult> {
    this.context.requirePermission('visit:amend');
    return this.recharge(id, { kind: 'amendment', ...input });
  }

  /**
   * Sets the visit discount at checkout (checkout handoff, C3–C5, ADR-0030) with
   * `visit:discount`: an amendment of the discount alone that keeps the visit's status and needs
   * no reason, on the visit's own day only (409 `visit.checkout_closed` afterwards; a later change
   * is an amendment). Same locks, staleness check, `visit_amendments` row (kind
   * `checkout_discount`) and `VisitAmended` as `amend`; audited `visit.discount`.
   */
  async setCheckoutDiscount(id: string, input: CheckoutDiscountInput): Promise<VisitResult> {
    this.context.requirePermission('visit:discount');
    return this.recharge(id, {
      kind: 'checkout_discount',
      expectedUpdatedAt: input.expectedUpdatedAt,
      discount: input.discount,
      reason: input.reason ?? null,
    });
  }

  /** What `amend` and `setCheckoutDiscount` share: the visit's money changes after completion. */
  private async recharge(
    id: string,
    change:
      | ({ kind: 'amendment' } & AmendVisitInput)
      | ({ kind: 'checkout_discount'; reason: string | null } & Pick<
          AmendVisitInput,
          'expectedUpdatedAt' | 'discount'
        >),
  ): Promise<VisitResult> {
    return this.tenantDb.run(async () => {
      const before = await this.locks.patientThenVisit(id, (visitId) =>
        this.visits.lockForCorrection(visitId),
      );
      const amended = correct(before.status, 'amend');
      if (change.kind === 'checkout_discount' && before.localDate !== (await this.today())) {
        throw new VisitCheckoutClosedError(
          "The discount is set at checkout on the visit's day; amend the visit instead",
        );
      }
      assertFresh(before, change.expectedUpdatedAt);
      const stored = await this.services.listForVisit(id);
      const plan = planAmendment(
        {
          discountMode: before.discountMode,
          discountValue: before.discountValue,
          services: stored.map(toAmendable),
        },
        {
          discount: change.discount,
          services:
            change.kind === 'amendment'
              ? change.services
              : stored.map((service) => ({ id: service.id })),
        },
      );
      const now = this.clock.now();
      // What a service did to its tooth follows the correction (feature 7, H2): gone with a
      // removed service, moved with one that changes tooth.
      const presenceContext = {
        patientId: before.patientId,
        visitId: id,
        occurredOn: before.localDate,
        dentistId: before.dentistId,
        userId: this.context.requireUserId(),
      };
      for (const service of plan.removed) {
        await this.services.update(service.id, { deletedAt: now });
        await this.presence.revertService(service.id, now);
      }
      for (const { id: serviceId, toothCode, surfaces } of plan.edited) {
        await this.services.update(serviceId, { toothCode, surfaces });
        await this.presence.moveService(presenceContext, { id: serviceId, toothCode }, now);
      }
      if (change.kind === 'amendment') {
        for (const planId of plan.plansToReopen) {
          await this.unperformer.unperform(planId, before, change.reason);
        }
      }
      const after = await this.visits.update(id, {
        status: change.kind === 'amendment' ? amended : before.status,
        discountMode: change.discount.mode,
        discountValue: change.discount.value,
        subtotal: plan.after.subtotal,
        discountAmount: plan.after.discountAmount,
        total: plan.after.total,
      });
      const amendmentId = await this.amendments.append({
        visitId: id,
        kind: change.kind,
        reason: change.reason,
        before: plan.before,
        after: plan.after,
        delta: plan.delta,
        currency: before.currency,
        amendedBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: change.kind === 'amendment' ? 'visit.amend' : 'visit.discount',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: plan.before,
        after: plan.after,
        reason: change.reason ?? undefined,
      });
      const event: VisitAmended = this.events.create(VISIT_AMENDED, {
        visitId: id,
        patientId: after.patientId,
        amendmentId,
        currency: after.currency,
        delta: plan.delta,
        reason: change.reason,
      });
      await this.events.publish(event);
      return { visit: await this.presenter.present(after) };
    });
  }

  /**
   * Closes a completed or amended visit's checkout without a payment (ADR-0033) with
   * `payment:write`: whoever collects has seen the patient out and the amount stays a receivable.
   * Stamps `checked_out_at` and `checked_out_by` once (a second call changes nothing), which takes
   * the visit out of the checkout queue; the status and the money are untouched. Audited
   * `visit.checkout`; no event. A live visit → 409 `visit.not_completed`.
   */
  async checkOut(id: string): Promise<VisitResult> {
    this.context.requirePermission('payment:write');
    return this.tenantDb.run(async () => {
      const before = await this.visits.lockForCorrection(id);
      if (before.status !== 'completed' && before.status !== 'amended') {
        throw new VisitNotCompletedError(`Visit is ${before.status}; it has no checkout to close`);
      }
      if (before.checkedOutAt !== null) return { visit: await this.presenter.present(before) };
      const after = await this.visits.update(id, {
        checkedOutAt: this.clock.now(),
        checkedOutBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'visit.checkout',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: { checkedOutAt: null },
        after: { checkedOutAt: after.checkedOutAt, checkedOutBy: after.checkedOutBy },
      });
      return { visit: await this.presenter.present(after) };
    });
  }

  /**
   * Voids a completed or amended visit (4b, D4, D6) with `visit:void`: it keeps its services,
   * money and records but counts nowhere. Same locks and staleness check as `amend`; audits
   * `visit.void` with the reason and publishes `VisitVoided` inside the transaction — `billing`
   * reverses the charge, or vetoes the void (409 `visit.has_payments`, ADR-0026), which rolls
   * everything back.
   */
  async void(id: string, input: VoidVisitInput): Promise<VisitResult> {
    this.context.requirePermission('visit:void');
    return this.tenantDb.run(async () => {
      const before = await this.locks.patientThenVisit(id, (visitId) =>
        this.visits.lockForCorrection(visitId),
      );
      const status = correct(before.status, 'void');
      assertFresh(before, input.expectedUpdatedAt);
      const now = this.clock.now();
      // The teeth its services took out or implanted are as they were before (H2).
      await this.presence.revertVisit(id, now);
      const after = await this.visits.update(id, {
        status,
        voidedAt: now,
        voidedBy: this.context.requireUserId(),
        voidReason: input.reason,
      });
      await this.audit.record({
        action: 'visit.void',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: { status: before.status },
        after: { status: after.status, voidedAt: after.voidedAt, voidedBy: after.voidedBy },
        reason: input.reason,
      });
      const event: VisitVoided = this.events.create(VISIT_VOIDED, {
        visitId: id,
        patientId: after.patientId,
        currency: after.currency,
        reason: input.reason,
      });
      await this.events.publish(event);
      return { visit: await this.presenter.present(after) };
    });
  }

  private async today(): Promise<string> {
    return localDate(this.clock.now(), (await this.tenancy.currentTenant()).timeZone);
  }
}
