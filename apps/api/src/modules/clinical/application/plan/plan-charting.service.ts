import {
  type PlanPriorityInput,
  type PlanResult,
  type PlanTreatmentInput,
  type RecordSessionInput,
  toCents,
  type ToothPresenceChange,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../../platform/events/event-bus';
import { AuditService } from '../../../audit';
import {
  acceptanceAfterUndo,
  acceptedByWork,
  assertInProgress,
  assertOpen,
  statusWithSessions,
} from '../../domain/plan-lifecycle';
import { assertCurrency } from '../../domain/record-rules';
import {
  PlanNotCancellableError,
  PlanNotOfVisitError,
  PlanNotOpenError,
  RecordNotFoundError,
  RecordNotRemovableError,
} from '../../domain/visit-errors';
import {
  TREATMENT_CANCELLED,
  TREATMENT_PERFORMED,
  TREATMENT_STARTED,
  type TreatmentCancelled,
  type TreatmentPerformed,
  type TreatmentStarted,
} from '../../events/record-events';
import { PlanSessionsRepository } from '../../persistence/plan-sessions.repository';
import {
  type StoredTreatmentPlan,
  TreatmentPlansRepository,
} from '../../persistence/treatment-plans.repository';
import { VisitServicesRepository } from '../../persistence/visit-services.repository';
import { PresenceWriter } from '../records/presence-writer';
import { RecordPresenter } from '../records/record-presenter';
import { RecordWriter } from '../records/record-writer';
import {
  presenceContextOf,
  recordContextOf,
  type VisitChange,
  VisitCharting,
} from '../records/visit-charting';
import { PlanUnperformer, planStatusOf } from './plan-unperformer';

const PLAN = 'treatment_plan';
const SERVICE = 'visit_service';

/**
 * The treatment plan in a live visit (docs/modules/clinical.md, Records in a visit): plan,
 * perform, cancel, remove, and work over several visits — Not finished, Continue and their undos
 * (ADR-0032). The patient is always the visit's; another patient's plan reads as not found.
 */
@Injectable()
export class PlanChartingService {
  constructor(
    private readonly charting: VisitCharting,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly services: VisitServicesRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly sessions: PlanSessionsRepository,
    private readonly presence: PresenceWriter,
    private readonly unperformer: PlanUnperformer,
    private readonly writer: RecordWriter,
    private readonly presenter: RecordPresenter,
  ) {}

  /**
   * A catalog service planned on the patient at its catalog price (a snapshot), following the
   * charge unit (W11), with its priority (ADR-0045). A per-tooth plan links the diagnosis it
   * names, else the tooth's most recent active one. `TreatmentPlanned`.
   */
  planTreatment(visitId: string, input: PlanTreatmentInput): Promise<PlanResult> {
    return this.charting.run(visitId, async (change) =>
      this.presenter.plan(await this.writer.planTreatment(recordContextOf(change), input)),
    );
  }

  /**
   * Not finished (unfinished spec U2): a service of this visit becomes work in progress, charged
   * by the visit that completes it (ADR-0032). The service is removed; its plan — the one it
   * performed, put back, or a new one from the service's own snapshot — takes the service's base
   * price (a line discount is not carried) and is `in_progress` with this visit's session.
   * `TreatmentStarted` when the work starts here, after `TreatmentPlanned` for a new plan.
   */
  markServiceUnfinished(visitId: string, serviceId: string): Promise<PlanResult> {
    return this.charting.run(visitId, async (change) => {
      const { visit, userId, now } = change;
      const service = await this.services.lockInVisit(serviceId, visitId);
      const removed = await this.services.update(serviceId, { deletedAt: now });
      await this.audit.record({
        action: `${SERVICE}.unfinished`,
        resourceType: SERVICE,
        resourceId: serviceId,
        before: service,
        after: { deletedAt: removed.deletedAt },
      });
      // The work is not done: the tooth is as it was (H2).
      await this.presence.revertService(serviceId, now);
      let plan: StoredTreatmentPlan;
      if (service.planId === null) {
        plan = await this.writer.planFromService(recordContextOf(change), service, visit.currency);
      } else {
        await this.unperformer.unperform(service.planId, visit);
        const reopened = await this.plans.lockForPatient(service.planId, visit.patientId);
        plan = reopened;
        if (toCents(reopened.priceAmount) !== toCents(service.baseAmount)) {
          plan = await this.plans.update(reopened.id, { priceAmount: service.baseAmount });
          await this.audit.record({
            action: `${PLAN}.reprice`,
            resourceType: PLAN,
            resourceId: plan.id,
            before: { priceAmount: reopened.priceAmount },
            after: { priceAmount: plan.priceAmount },
          });
        }
      }
      if (plan.status === 'planned') return this.presenter.plan(await this.start(plan, change));
      // Work continued from earlier visits, completed here and reopened: this visit worked on it.
      if (!(await this.sessions.find(plan.id, visitId))) {
        await this.sessions.insert({ planId: plan.id, visitId, note: null, recordedBy: userId });
        await this.audit.record({
          action: `${PLAN}.session`,
          resourceType: PLAN,
          resourceId: plan.id,
          after: { visitId, note: null },
        });
      }
      return this.presenter.plan(plan);
    });
  }

  /**
   * Continue today: this visit's session on a plan in progress, with an optional note. One per
   * visit: a repeat updates the note, and an unchanged one changes and audits nothing. On a plan
   * that is still only planned it is the visit's *Not finished* (feature 10, ADR-0048): the work
   * starts here, with this session and no charge (`TreatmentStarted`). A performed or cancelled
   * plan answers 409 `plan.not_in_progress`.
   */
  recordSession(visitId: string, planId: string, input: RecordSessionInput): Promise<PlanResult> {
    return this.charting.run(visitId, async (change) => {
      const { visit, userId } = change;
      const plan = await this.plans.lockForPatient(planId, visit.patientId);
      if (plan.status === 'planned') {
        return this.presenter.plan(await this.start(plan, change, input.note));
      }
      assertInProgress(plan);
      const existing = await this.sessions.find(planId, visitId);
      if (!existing || existing.note !== input.note) {
        const session = existing
          ? await this.sessions.update(existing.id, { note: input.note })
          : await this.sessions.insert({ planId, visitId, note: input.note, recordedBy: userId });
        await this.audit.record({
          action: `${PLAN}.session`,
          resourceType: PLAN,
          resourceId: planId,
          before: existing ? { visitId, note: existing.note } : undefined,
          after: { visitId, note: session.note },
        });
      }
      return this.presenter.plan(plan);
    });
  }

  /**
   * The Undo of Continue, and of Not finished: removes this visit's session (404 `record.not_found`
   * without one) from a plan in progress. When it was the plan's only session the plan goes back
   * to `planned`, as if it had never been started; when it was the starting visit's, the start
   * moves to the oldest session left.
   */
  removeSession(visitId: string, planId: string): Promise<PlanResult> {
    return this.charting.run(visitId, async ({ visit, now }) => {
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      assertInProgress(before);
      const session = await this.sessions.find(planId, visitId);
      if (!session) throw new RecordNotFoundError('This visit has no session on this plan');
      await this.sessions.update(session.id, { deletedAt: now });
      // The start follows the oldest session left; with none, the plan was never started.
      const oldest = await this.sessions.oldestForPlan(planId);
      const status = statusWithSessions(oldest ? 1 : 0);
      const after =
        oldest?.visitId === before.startedInVisitId
          ? before
          : await this.plans.update(planId, {
              status,
              startedInVisitId: oldest?.visitId ?? null,
              startedAt: oldest?.createdAt ?? null,
              ...acceptanceAfterUndo(before, status, before.startedAt),
            });
      await this.audit.record({
        action: `${PLAN}.session_delete`,
        resourceType: PLAN,
        resourceId: planId,
        before: { ...planStatusOf(before), visitId, note: session.note },
        after: planStatusOf(after),
      });
      return this.presenter.plan(after);
    });
  }

  /**
   * Perform now, or Complete for an unfinished service: an open plan (else 409 `plan.not_open`)
   * becomes a service of this visit at the plan's price, tooth and surfaces, and is marked
   * performed here — the one charge of the work, however many visits it took (ADR-0032). The
   * plan's currency must be the visit's (W12). `TreatmentPerformed`; the new service is in the
   * answer's visit.
   */
  async performPlan(visitId: string, planId: string): Promise<PlanResult> {
    let presenceChange: ToothPresenceChange | null = null;
    const result = await this.charting.run(visitId, async (change) => {
      const { visit, userId, now } = change;
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      assertOpen(before);
      assertCurrency(visit.currency, before.priceCurrency);
      const service = await this.services.insert({
        visitId,
        procedureId: before.procedureId,
        code: before.code,
        name: before.name,
        category: before.category,
        chargeUnit: before.chargeUnit,
        toothCode: before.toothCode,
        jaw: before.jaw,
        surfaces: before.surfaces,
        baseAmount: before.priceAmount,
        planId,
        recordedBy: userId,
      });
      const after = await this.plans.update(planId, {
        status: 'performed',
        performedInVisitId: visitId,
        performedAt: now,
        // Work done was agreed to (ADR-0045).
        ...acceptedByWork(before, { userId, now }),
      });
      await this.audit.record({
        action: `${SERVICE}.create`,
        resourceType: SERVICE,
        resourceId: service.id,
        after: service,
      });
      await this.audit.record({
        action: `${PLAN}.perform`,
        resourceType: PLAN,
        resourceId: planId,
        before: planStatusOf(before),
        after: { ...planStatusOf(after), serviceId: service.id },
      });
      const event: TreatmentPerformed = this.events.create(TREATMENT_PERFORMED, {
        planId,
        visitId,
        patientId: visit.patientId,
        serviceId: service.id,
        toothCode: after.toothCode,
      });
      await this.events.publish(event);
      presenceChange = await this.presence.applyService(presenceContextOf(change), service);
      return this.presenter.plan(after);
    });
    return { ...result, presenceChange };
  }

  /**
   * An open plan from an earlier visit or from the patient record — planned, or abandoned while
   * in progress (409 `plan.not_cancellable` for one made in this visit, which is removed instead;
   * W13). `TreatmentCancelled`.
   */
  cancelPlan(visitId: string, planId: string): Promise<PlanResult> {
    return this.charting.run(visitId, async ({ visit, now }) => {
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      if (before.recordedInVisitId === visitId) {
        throw new PlanNotCancellableError('A plan made in this visit is removed, not cancelled');
      }
      assertOpen(before);
      const after = await this.plans.update(planId, {
        status: 'cancelled',
        cancelledInVisitId: visitId,
        cancelledAt: now,
      });
      await this.audit.record({
        action: `${PLAN}.cancel`,
        resourceType: PLAN,
        resourceId: planId,
        before: planStatusOf(before),
        after: planStatusOf(after),
      });
      const event: TreatmentCancelled = this.events.create(TREATMENT_CANCELLED, {
        planId,
        visitId,
        patientId: visit.patientId,
        toothCode: after.toothCode,
      });
      await this.events.publish(event);
      return this.presenter.plan(after);
    });
  }

  /**
   * The phase of a plan made in this visit (ADR-0045): its priority, set from the Plan step's
   * proposal card. A plan from before is prioritised on the patient record, with `chart:write`
   * (409 `plan.not_of_visit` here). `TreatmentPrioritised`.
   */
  setPriority(visitId: string, planId: string, input: PlanPriorityInput): Promise<PlanResult> {
    return this.charting.run(visitId, async ({ visit }) => {
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      if (before.recordedInVisitId !== visitId) {
        throw new PlanNotOfVisitError(
          'Only a plan made in this visit is prioritised here; use the treatment plan',
        );
      }
      return this.presenter.plan(await this.writer.prioritise(before, input.priority, visitId));
    });
  }

  /**
   * Only a plan made in this visit (else 409 `plan.not_of_visit`; older ones are cancelled)
   * that is still `planned` (else 409 `plan.not_open`: undo the perform first). Soft delete.
   */
  removePlan(visitId: string, planId: string): Promise<PlanResult> {
    return this.charting.run(visitId, async ({ visit, now }) => {
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      if (before.recordedInVisitId !== visitId) {
        throw new RecordNotRemovableError(
          'Only a plan made in this visit can be removed; cancel older ones',
        );
      }
      if (before.status !== 'planned') {
        throw new PlanNotOpenError(`This plan is ${before.status}`);
      }
      const after = await this.plans.update(planId, { deletedAt: now });
      await this.audit.record({
        action: `${PLAN}.delete`,
        resourceType: PLAN,
        resourceId: planId,
        before,
        after: { deletedAt: after.deletedAt },
      });
      return this.presenter.plan(after);
    });
  }

  /** `planned` → `in_progress` with this visit's first session; audited, `TreatmentStarted`. */
  private async start(
    before: StoredTreatmentPlan,
    { visit, userId, now }: VisitChange,
    note: string | null = null,
  ): Promise<StoredTreatmentPlan> {
    const after = await this.plans.update(before.id, {
      status: 'in_progress',
      startedInVisitId: visit.id,
      startedAt: now,
      ...acceptedByWork(before, { userId, now }),
    });
    await this.sessions.insert({
      planId: before.id,
      visitId: visit.id,
      note,
      recordedBy: userId,
    });
    await this.audit.record({
      action: `${PLAN}.start`,
      resourceType: PLAN,
      resourceId: before.id,
      before: planStatusOf(before),
      after: planStatusOf(after),
    });
    const event: TreatmentStarted = this.events.create(TREATMENT_STARTED, {
      planId: before.id,
      visitId: visit.id,
      patientId: visit.patientId,
      toothCode: after.toothCode,
    });
    await this.events.publish(event);
    return after;
  }
}
