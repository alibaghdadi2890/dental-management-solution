import {
  type AddServiceInput,
  type AnswerUnfinishedInput,
  type DiagnosisResult,
  type PermanentToothCode,
  type PlanResult,
  type PlanTreatmentInput,
  type RecordDiagnosisInput,
  type RecordSessionInput,
  type ServiceResult,
  type SetToothPresenceInput,
  toCents,
  type ToothPresenceResult,
  type UpdateServiceInput,
  type Visit,
  type VisitResult,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { CatalogItemInactiveError } from '../domain/catalog-errors';
import { assertInProgress, assertOpen, statusWithSessions } from '../domain/plan-lifecycle';
import { assertCurrency, assertLinePrice, assertTarget } from '../domain/record-rules';
import {
  PlanNotCancellableError,
  PlanNotOpenError,
  RecordNotFoundError,
  RecordNotRemovableError,
} from '../domain/visit-errors';
import {
  DIAGNOSIS_REOPENED,
  DIAGNOSIS_RESOLVED,
  type DiagnosisReopened,
  type DiagnosisResolved,
  TOOTH_STATUS_CHANGED,
  type ToothStatusChanged,
  TREATMENT_CANCELLED,
  TREATMENT_PERFORMED,
  TREATMENT_STARTED,
  type TreatmentCancelled,
  type TreatmentPerformed,
  type TreatmentStarted,
} from '../events/record-events';
import {
  type DiagnosisRecordPatch,
  PatientDiagnosesRepository,
  type StoredDiagnosisRecord,
} from '../persistence/patient-diagnoses.repository';
import { PlanSessionsRepository } from '../persistence/plan-sessions.repository';
import { ToothStatusRepository } from '../persistence/tooth-status.repository';
import {
  type StoredTreatmentPlan,
  TreatmentPlansRepository,
} from '../persistence/treatment-plans.repository';
import {
  type StoredVisitService,
  VisitServicesRepository,
} from '../persistence/visit-services.repository';
import { type StoredVisit, VisitsRepository } from '../persistence/visits.repository';
import { CatalogService } from './catalog.service';
import { PlanUnperformer, planStatusOf } from './plan-unperformer';
import { type RecordContext, RecordWriter } from './record-writer';
import { toDiagnosisRecord, toTreatmentPlan } from './record-mapping';
import { toVisit, toVisitService } from './visit-mapping';

/** What one charting change sees: the live visit (locked), the actor and the clock. */
interface Change {
  visit: StoredVisit;
  userId: string;
  now: Date;
}

const DIAGNOSIS = 'diagnosis_record';
const PLAN = 'treatment_plan';
const SERVICE = 'visit_service';

/** The fields resolve and reopen change, for the audit's before/after. */
const resolutionOf = ({ status, resolvedInVisitId, resolvedAt }: StoredDiagnosisRecord) => ({
  status,
  resolvedInVisitId,
  resolvedAt,
});

const priceOf = ({ baseAmount, discountAmount }: StoredVisitService) => ({
  baseAmount,
  discountAmount,
});

/**
 * Charting inside a live visit (docs/modules/clinical.md, spec §VisitRecordsService): services,
 * diagnoses, plans and tooth presence. Every method re-checks `visit:write`, runs in one
 * `TenantDb` transaction, locks the visit `FOR UPDATE` and refuses unless it is live (409
 * `visit.not_live`), and answers with the updated `Visit` plus the affected record. The patient is
 * always the visit's; records of another patient read as not found. Catalog items must be active
 * (422 `catalog.inactive`) and are copied as snapshots. `recorded_by`/`changed_by` hold the auth
 * user id and `dentist_id` the visit's dentist (W10). Every change is audited with before/after;
 * diagnosis, plan and tooth changes also publish their event after commit (spec §Events).
 */
@Injectable()
export class VisitRecordsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    private readonly catalog: CatalogService,
    private readonly visits: VisitsRepository,
    private readonly services: VisitServicesRepository,
    private readonly diagnoses: PatientDiagnosesRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly sessions: PlanSessionsRepository,
    private readonly teeth: ToothStatusRepository,
    private readonly unperformer: PlanUnperformer,
    private readonly writer: RecordWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Services ---

  /** A catalog service at its catalog price, no line discount (W11, W12). */
  addService(visitId: string, input: AddServiceInput): Promise<ServiceResult> {
    return this.inVisit(visitId, async ({ visit, userId }) => {
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
      return toVisitService(service, visit.currency);
    });
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
    return this.inVisit(visitId, async ({ visit }) => {
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
  removeService(visitId: string, serviceId: string): Promise<ServiceResult> {
    return this.inVisit(visitId, async (change) => {
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
      if (before.planId !== null) {
        await this.unperformer.unperform(before.planId, visit);
        await this.dropWorkStartedHere(before.planId, change);
      }
      return toVisitService(after, visit.currency);
    });
  }

  // --- Diagnoses ---

  /** On a tooth always (W11); `DiagnosisRecorded`. */
  recordDiagnosis(visitId: string, input: RecordDiagnosisInput): Promise<DiagnosisResult> {
    return this.inVisit(visitId, async (change) => {
      const record = await this.writer.recordDiagnosis(this.recordContext(change), input);
      return this.diagnosisRecord(record, change.visit.localDate);
    });
  }

  /**
   * Any of the patient's diagnoses, whichever visit recorded it; stamps this visit. Idempotent: a
   * resolved one is returned unchanged (no audit, no event).
   */
  resolveDiagnosis(visitId: string, recordId: string): Promise<DiagnosisResult> {
    return this.changeDiagnosis(visitId, recordId, 'resolve', ({ now }) => ({
      status: 'resolved',
      resolvedInVisitId: visitId,
      resolvedAt: now,
    }));
  }

  /** Clears both resolved fields. Idempotent like `resolveDiagnosis`. */
  reopenDiagnosis(visitId: string, recordId: string): Promise<DiagnosisResult> {
    return this.changeDiagnosis(visitId, recordId, 'reopen', () => ({
      status: 'active',
      resolvedInVisitId: null,
      resolvedAt: null,
    }));
  }

  /**
   * Only a diagnosis recorded in this visit (else 409 `record.not_removable`; older ones are
   * resolved, W13). Plans linked to it are unlinked, then it is soft-deleted.
   */
  removeDiagnosis(visitId: string, recordId: string): Promise<DiagnosisResult> {
    return this.inVisit(visitId, async ({ visit, now }) => {
      const { record: before, visitDate } = await this.diagnoses.lockForPatient(
        recordId,
        visit.patientId,
      );
      if (before.recordedInVisitId !== visitId) {
        throw new RecordNotRemovableError(
          'Only a diagnosis recorded in this visit can be removed; resolve older ones',
        );
      }
      const unlinkedPlanIds = await this.plans.unlinkDiagnosis(visit.patientId, recordId);
      const after = await this.diagnoses.update(recordId, { deletedAt: now });
      await this.audit.record({
        action: `${DIAGNOSIS}.delete`,
        resourceType: DIAGNOSIS,
        resourceId: recordId,
        before,
        after: { deletedAt: after.deletedAt, unlinkedPlanIds },
      });
      return this.diagnosisRecord(after, visitDate);
    });
  }

  // --- Plans ---

  /**
   * A catalog service planned on the patient at its catalog price (a snapshot), following the
   * charge unit (W11), optionally in one of the patient's named plans. A per-tooth plan links the
   * tooth's most recent active diagnosis. `TreatmentPlanned`.
   */
  planTreatment(visitId: string, input: PlanTreatmentInput): Promise<PlanResult> {
    return this.inVisit(visitId, async (change) =>
      this.treatmentPlan(await this.writer.planTreatment(this.recordContext(change), input)),
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
    return this.inVisit(visitId, async (change) => {
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
      let plan: StoredTreatmentPlan;
      if (service.planId === null) {
        plan = await this.writer.planFromService(
          this.recordContext(change),
          service,
          visit.currency,
        );
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
      if (plan.status === 'planned') return this.treatmentPlan(await this.start(plan, change));
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
      return this.treatmentPlan(plan);
    });
  }

  /**
   * The visit's answer to "which unfinished services do you continue today?" (unfinished spec
   * U5): this visit's session on each listed plan — the patient's and in progress (else 404
   * `record.not_found`, 409 `plan.not_in_progress`) — and the visit stamped as having answered.
   * A repeat adds the sessions it names and keeps the first stamp. The stamp is not visit
   * content: a visit that only answered "Not today" can still be discarded.
   */
  async answerUnfinished(visitId: string, input: AnswerUnfinishedInput): Promise<VisitResult> {
    this.context.requirePermission('visit:write');
    const userId = this.context.requireUserId();
    return this.tenantDb.run(async () => {
      const before = await this.visits.lockLive(visitId);
      const now = this.clock.now();
      for (const planId of [...input.continue].sort()) {
        const plan = await this.plans.lockForPatient(planId, before.patientId);
        assertInProgress(plan);
        if (await this.sessions.find(planId, visitId)) continue;
        await this.sessions.insert({ planId, visitId, note: null, recordedBy: userId });
        await this.audit.record({
          action: `${PLAN}.session`,
          resourceType: PLAN,
          resourceId: planId,
          after: { visitId, note: null },
        });
      }
      let visit = before;
      if (before.unfinishedAnsweredAt === null) {
        visit = await this.visits.update(visitId, { unfinishedAnsweredAt: now });
        await this.audit.record({
          action: 'visit.unfinished_answered',
          resourceType: 'visit',
          resourceId: visitId,
          after: { continued: input.continue },
        });
      }
      return { visit: toVisit(visit, await this.services.listForVisit(visitId), now) };
    });
  }

  /**
   * Continue today: this visit's session on a plan in progress (else 409 `plan.not_in_progress`),
   * with an optional note. One per visit: a repeat updates the note, and an unchanged one changes
   * and audits nothing.
   */
  recordSession(visitId: string, planId: string, input: RecordSessionInput): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, userId }) => {
      const plan = await this.plans.lockForPatient(planId, visit.patientId);
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
      return this.treatmentPlan(plan);
    });
  }

  /**
   * The Undo of Continue, and of Not finished: removes this visit's session (404 `record.not_found`
   * without one) from a plan in progress. When it was the plan's only session the plan goes back
   * to `planned`, as if it had never been started; when it was the starting visit's, the start
   * moves to the oldest session left.
   */
  removeSession(visitId: string, planId: string): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, now }) => {
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      assertInProgress(before);
      const session = await this.sessions.find(planId, visitId);
      if (!session) throw new RecordNotFoundError('This visit has no session on this plan');
      await this.sessions.update(session.id, { deletedAt: now });
      // The start follows the oldest session left; with none, the plan was never started.
      const oldest = await this.sessions.oldestForPlan(planId);
      const after =
        oldest?.visitId === before.startedInVisitId
          ? before
          : await this.plans.update(planId, {
              status: statusWithSessions(oldest ? 1 : 0),
              startedInVisitId: oldest?.visitId ?? null,
              startedAt: oldest?.createdAt ?? null,
            });
      await this.audit.record({
        action: `${PLAN}.session_delete`,
        resourceType: PLAN,
        resourceId: planId,
        before: { ...planStatusOf(before), visitId, note: session.note },
        after: planStatusOf(after),
      });
      return this.treatmentPlan(after);
    });
  }

  /**
   * Perform now, or Complete for an unfinished service: an open plan (else 409 `plan.not_open`)
   * becomes a service of this visit at the plan's price, tooth and surfaces, and is marked
   * performed here — the one charge of the work, however many visits it took (ADR-0032). The
   * plan's currency must be the visit's (W12). `TreatmentPerformed`; the new service is in the
   * answer's visit.
   */
  performPlan(visitId: string, planId: string): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, userId, now }) => {
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
      return this.treatmentPlan(after);
    });
  }

  /**
   * An open plan from an earlier visit or from the patient record — planned, or abandoned while
   * in progress (409 `plan.not_cancellable` for one made in this visit, which is removed instead;
   * W13). `TreatmentCancelled`.
   */
  cancelPlan(visitId: string, planId: string): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, now }) => {
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
      return this.treatmentPlan(after);
    });
  }

  /**
   * Only a plan made in this visit (else 409 `record.not_removable`; older ones are cancelled)
   * that is still `planned` (else 409 `plan.not_open`: undo the perform first). Soft delete.
   */
  removePlan(visitId: string, planId: string): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, now }) => {
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
      return this.treatmentPlan(after);
    });
  }

  // --- Tooth presence ---

  /**
   * Which tooth is present at a succession position (W5), changed in this visit (W15): an upsert
   * on `(patient, position)`. An unchanged value changes, audits and emits nothing.
   * `ToothStatusChanged`.
   */
  setToothPresence(
    visitId: string,
    position: PermanentToothCode,
    input: SetToothPresenceInput,
  ): Promise<ToothPresenceResult> {
    return this.inVisit(visitId, async ({ visit, userId }) => {
      const before = await this.teeth.lockAt(visit.patientId, position);
      if (before?.present !== input.present) {
        const after = await this.teeth.upsert({
          patientId: visit.patientId,
          position,
          present: input.present,
          changedInVisitId: visitId,
          changedBy: userId,
        });
        await this.audit.record({
          action: 'tooth_status.set',
          resourceType: 'tooth_status',
          resourceId: after.id,
          before: before && { position, present: before.present },
          after: { position, present: after.present },
        });
        const event: ToothStatusChanged = this.events.create(TOOTH_STATUS_CHANGED, {
          visitId,
          patientId: visit.patientId,
          position,
          present: after.present,
        });
        await this.events.publish(event);
      }
      return { position, present: input.present };
    });
  }

  // --- Shared rules ---

  /**
   * One charting change: `visit:write`, one transaction, the visit locked `FOR UPDATE` and live
   * (`lockLive`), then `work`. Answers `{ visit, record }` with the visit as it now is.
   */
  private async inVisit<TRecord>(
    visitId: string,
    work: (change: Change) => Promise<TRecord>,
  ): Promise<{ visit: Visit; record: TRecord }> {
    this.context.requirePermission('visit:write');
    const userId = this.context.requireUserId();
    return this.tenantDb.run(async () => {
      const visit = await this.visits.lockLive(visitId);
      const now = this.clock.now();
      const record = await work({ visit, userId, now });
      return { visit: toVisit(visit, await this.services.listForVisit(visitId), now), record };
    });
  }

  /** Resolve or reopen: the patient's diagnosis, locked; unchanged when already in that state. */
  private changeDiagnosis(
    visitId: string,
    recordId: string,
    verb: 'resolve' | 'reopen',
    patch: (change: Change) => DiagnosisRecordPatch,
  ): Promise<DiagnosisResult> {
    return this.inVisit(visitId, async (change) => {
      const { visit } = change;
      const { record: before, visitDate } = await this.diagnoses.lockForPatient(
        recordId,
        visit.patientId,
      );
      const target = verb === 'resolve' ? 'resolved' : 'active';
      if (before.status === target) return this.diagnosisRecord(before, visitDate);
      const after = await this.diagnoses.update(recordId, patch(change));
      await this.audit.record({
        action: `${DIAGNOSIS}.${verb}`,
        resourceType: DIAGNOSIS,
        resourceId: recordId,
        before: resolutionOf(before),
        after: resolutionOf(after),
      });
      const payload = {
        recordId,
        visitId,
        patientId: visit.patientId,
        toothCode: after.toothCode,
      };
      const event: DiagnosisResolved | DiagnosisReopened =
        verb === 'resolve'
          ? this.events.create(DIAGNOSIS_RESOLVED, payload)
          : this.events.create(DIAGNOSIS_REOPENED, payload);
      await this.events.publish(event);
      return this.diagnosisRecord(after, visitDate);
    });
  }

  /** The visit as the place a record is made: its patient and its dentist (W10). */
  private recordContext({ visit, userId, now }: Change): RecordContext {
    return {
      patientId: visit.patientId,
      visitId: visit.id,
      dentistId: visit.dentistId,
      userId,
      now,
    };
  }

  private async dentistName(profileId: string): Promise<string> {
    const [dentist] = await this.users.practitionersByProfileIds([profileId]);
    return dentist?.displayName ?? '';
  }

  /** `visitDate` is the recording visit's local date; a record made without a visit (ADR-0031) is
   * dated by `recordedAt` in the tenant's time zone. */
  private async diagnosisRecord(record: StoredDiagnosisRecord, visitDate: string | null) {
    const recordedDate =
      visitDate ?? localDate(record.recordedAt, (await this.tenancy.currentTenant()).timeZone);
    return toDiagnosisRecord(record, recordedDate, await this.dentistName(record.dentistId));
  }

  private async treatmentPlan(plan: StoredTreatmentPlan) {
    const sessions = (await this.sessions.listForPlans([plan.id])).map(
      ({ visitId, date, note }) => ({ visitId, date, note }),
    );
    return toTreatmentPlan(plan, await this.dentistName(plan.dentistId), sessions);
  }

  /**
   * After a service of this visit was removed and its plan put back: when this visit's session is
   * the plan's only one, the work was first added here (Not finished, then completed), so the
   * session goes too and the plan was never started — and a plan this visit recorded is removed
   * with it, as the service it stood for is gone.
   */
  private async dropWorkStartedHere(planId: string, { visit, now }: Change): Promise<void> {
    const before = await this.plans.lockForPatient(planId, visit.patientId);
    const session = await this.sessions.find(planId, visit.id);
    if (before.status !== 'in_progress' || !session) return;
    if ((await this.sessions.countForPlan(planId)) !== 1) return;
    await this.sessions.update(session.id, { deletedAt: now });
    const madeHere = before.recordedInVisitId === visit.id;
    const after = await this.plans.update(planId, {
      status: 'planned',
      startedInVisitId: null,
      startedAt: null,
      ...(madeHere && { deletedAt: now }),
    });
    await this.audit.record({
      action: `${PLAN}.session_delete`,
      resourceType: PLAN,
      resourceId: planId,
      before: { ...planStatusOf(before), visitId: visit.id, note: session.note },
      after: planStatusOf(after),
    });
    if (madeHere) {
      await this.audit.record({
        action: `${PLAN}.delete`,
        resourceType: PLAN,
        resourceId: planId,
        before,
        after: { deletedAt: after.deletedAt },
      });
    }
  }

  /** `planned` → `in_progress` with this visit's first session; audited, `TreatmentStarted`. */
  private async start(
    before: StoredTreatmentPlan,
    { visit, userId, now }: Change,
  ): Promise<StoredTreatmentPlan> {
    const after = await this.plans.update(before.id, {
      status: 'in_progress',
      startedInVisitId: visit.id,
      startedAt: now,
    });
    await this.sessions.insert({
      planId: before.id,
      visitId: visit.id,
      note: null,
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
