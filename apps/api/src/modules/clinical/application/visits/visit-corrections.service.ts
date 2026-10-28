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
import { newId } from '../../../../platform/kernel/id';
import { localDate } from '../../../../platform/kernel/local-date';
import { AuditService } from '../../../audit';
import { TenancyService } from '../../../tenancy';
import {
  type AddableService,
  type AmendableService,
  type AmendmentSnapshot,
  planAmendment,
} from '../../domain/visit-amendment';
import {
  AmendNoChangeError,
  VisitCheckoutClosedError,
  VisitImportedError,
  VisitNotCompletedError,
  VisitStaleError,
} from '../../domain/visit-errors';
import { correct } from '../../domain/visit-lifecycle';
import { planVisitTimes, type VisitTimes } from '../../domain/visit-times';
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
import { CatalogService } from '../catalog/catalog.service';
import { PlanUnperformer } from '../plan/plan-unperformer';
import { PresenceWriter } from '../records/presence-writer';
import { VisitLocks } from './visit-locks';
import { VisitPresenter } from './visit-presenter';
import { assertVisitInScope } from './visit-scope';

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

/** An imported visit was never charged here: only its times may be corrected (ADR-0053,
 * ADR-0062). */
function assertNotImported(visit: StoredVisit): void {
  if (visit.importedAt !== null) {
    throw new VisitImportedError(
      'This visit was imported from the previous system; only its times can be corrected',
    );
  }
}

/** D8: the client's `expectedUpdatedAt` must be the visit's current `updated_at`. */
function assertFresh(visit: StoredVisit, expectedUpdatedAt: string): void {
  if (visit.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new VisitStaleError('The visit changed since you opened it; reload and try again');
  }
}

/** A snapshot with the visit's start and end, on a correction that changed them (ADR-0062). */
function withTimes(
  side: AmendmentSnapshot,
  times: { startedAt: Date; completedAt: Date | null } | null,
): AmendmentSnapshot {
  if (!times?.completedAt) return side;
  return {
    ...side,
    startedAt: times.startedAt.toISOString(),
    completedAt: times.completedAt.toISOString(),
  };
}

/** The times a time correction audits, before and after. */
const timesOf = (visit: StoredVisit) => ({
  startedAt: visit.startedAt,
  completedAt: visit.completedAt,
  pausedSeconds: visit.pausedSeconds,
  durationMinutes: visit.durationMinutes,
});

/**
 * What changes a visit after it was completed (docs/modules/clinical.md, feature 4b): amend
 * ("Correct visit", ADR-0062), the discount at checkout, closing the checkout, and void. Each
 * re-checks its own permission, runs in one `TenantDb` transaction under the ADR-0023 locks,
 * refuses a stale `expectedUpdatedAt`, is audited, and publishes its event inside the transaction
 * so `billing` follows before commit.
 */
@Injectable()
export class VisitCorrectionsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly catalog: CatalogService,
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
   * Corrects a completed (or already amended) visit (4b, D1–D4, ADR-0025, ADR-0062) with
   * `visit:amend`: the services that stay may change tooth, surfaces and price, the others are
   * soft-deleted (a plan one of them performed returns to `planned`, D2), catalog services may be
   * added, the visit discount may change, and so may its start and end (`planVisitTimes`). Locks
   * the patient then the visit (ADR-0023, as `complete`) and refuses a stale `expectedUpdatedAt`
   * (409 `visit.stale`). A change to the services or the money makes the visit `amended`,
   * recomputes and freezes its money, appends a `visit_amendments` row with the before/after
   * snapshots (with the times when they changed too), audits `visit.amend` with the reason, and
   * publishes `VisitAmended` inside the transaction so `billing` posts the delta before commit. A
   * change to the times alone keeps the status, writes no amendment and publishes nothing; it is
   * audited `visit.times`. A typed price or a discount change also needs `visit:discount`
   * (ADR-0055). An imported visit may only have its times corrected (409 `visit.imported`).
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
      if (change.kind === 'checkout_discount') assertNotImported(before);
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
          currency: before.currency,
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
        {
          catalog: change.kind === 'amendment' ? await this.addable(change) : new Map(),
          newId,
        },
      );
      const times = change.kind === 'amendment' ? await this.correctedTimes(before, change) : null;
      if (!plan.changed) {
        if (!times || change.kind !== 'amendment') {
          throw new AmendNoChangeError('The correction changes nothing');
        }
        return this.correctTimes(before, times, change.reason);
      }
      assertNotImported(before);
      if (plan.pricingChanged) this.context.requirePermission('visit:discount');
      const now = this.clock.now();
      // What a service did to its tooth follows the correction (feature 7, H2): gone with a
      // removed service, moved with one that changes tooth, applied by one that is added.
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
      for (const { id: serviceId, baseAmount } of plan.priced) {
        await this.services.update(serviceId, { baseAmount, discountAmount: '0.00' });
      }
      for (const service of plan.added) {
        const inserted = await this.services.insert({
          ...service,
          visitId: id,
          planId: null,
          recordedBy: this.context.requireUserId(),
        });
        await this.presence.applyService(presenceContext, inserted);
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
        ...times,
      });
      const snapshots = {
        before: withTimes(plan.before, times && before),
        after: withTimes(plan.after, times),
      };
      const amendmentId = await this.amendments.append({
        visitId: id,
        kind: change.kind,
        reason: change.reason,
        ...snapshots,
        delta: plan.delta,
        currency: before.currency,
        amendedBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: change.kind === 'amendment' ? 'visit.amend' : 'visit.discount',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        ...snapshots,
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
      assertVisitInScope(this.context, before);
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
      assertNotImported(before);
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

  /** The catalog services a correction adds, as the catalog has them now (404 for an unknown). */
  private async addable(input: AmendVisitInput): Promise<Map<string, AddableService>> {
    const catalog = new Map<string, AddableService>();
    for (const entry of input.services) {
      if (!('procedureId' in entry) || catalog.has(entry.procedureId)) continue;
      catalog.set(entry.procedureId, await this.catalog.getServiceForRecord(entry.procedureId));
    }
    return catalog;
  }

  /** The corrected start and end (ADR-0062), or null when the input leaves them as they are. */
  private async correctedTimes(
    visit: StoredVisit,
    input: AmendVisitInput,
  ): Promise<VisitTimes | null> {
    if (!input.times || !visit.completedAt) return null;
    return planVisitTimes(
      {
        localDate: visit.localDate,
        startedAt: visit.startedAt,
        completedAt: visit.completedAt,
        pausedSeconds: visit.pausedSeconds,
      },
      {
        startedAt: new Date(input.times.startedAt),
        completedAt: new Date(input.times.completedAt),
      },
      (await this.tenancy.currentTenant()).timeZone,
      this.clock.now(),
    );
  }

  /**
   * A correction of the times alone (ADR-0062), imported visits included: the pauses are dropped
   * and the duration recomputed. Nothing else changes — not the status, the money or the local
   * date — so no amendment is written and no event is published; audited `visit.times` with the
   * reason and both sets of times.
   */
  private async correctTimes(
    before: StoredVisit,
    times: VisitTimes,
    reason: string,
  ): Promise<VisitResult> {
    const after = await this.visits.update(before.id, times);
    await this.audit.record({
      action: 'visit.times',
      resourceType: 'visit',
      resourceId: before.id,
      patientId: before.patientId,
      before: timesOf(before),
      after: timesOf(after),
      reason,
    });
    return { visit: await this.presenter.present(after) };
  }

  private async today(): Promise<string> {
    return localDate(this.clock.now(), (await this.tenancy.currentTenant()).timeZone);
  }
}
