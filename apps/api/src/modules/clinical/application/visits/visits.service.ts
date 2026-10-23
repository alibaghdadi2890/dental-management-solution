import {
  durationMinutes,
  defaultWorklist,
  firstStep,
  inVisitScope,
  type LiveVisitQuery,
  type LiveVisitRef,
  type StartDefaults,
  type StartVisitInput,
  type StartVisitResult,
  toCents,
  type Visit,
  type VisitDiscountInput,
  type VisitNotesInput,
  type VisitResult,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import { EventBus } from '../../../../platform/events/event-bus';
import type { Clock } from '../../../../platform/kernel/clock';
import { localDate } from '../../../../platform/kernel/local-date';
import { AuditService } from '../../../audit';
import { PatientArchivedError, PatientsService } from '../../../patients';
import { TenancyService } from '../../../tenancy';
import { UsersService } from '../../../users';
import { isDiscardable } from '../../domain/discard-rule';
import {
  BranchRequiredError,
  DentistInvalidError,
  RoomInvalidError,
  RoomRequiredError,
  VisitLiveElsewhereError,
  VisitNotEmptyError,
  VisitNotFoundError,
  VisitPlanInvalidError,
  VisitPlansNotAllowedError,
} from '../../domain/visit-errors';
import { transition } from '../../domain/visit-lifecycle';
import { elapsedSeconds, resumePausedSeconds } from '../../domain/visit-timer';
import {
  VISIT_COMPLETED,
  VISIT_DISCARDED,
  VISIT_PAUSED,
  VISIT_RESUMED,
  VISIT_STARTED,
  type VisitCompleted,
  type VisitDiscarded,
  type VisitPaused,
  type VisitResumed,
  type VisitStarted,
} from '../../events/visit-events';
import { ProceduresRepository } from '../../persistence/procedures.repository';
import { TreatmentPlansRepository } from '../../persistence/treatment-plans.repository';
import { VisitCountersRepository } from '../../persistence/visit-counters.repository';
import { VisitPlanItemsRepository } from '../../persistence/visit-plan-items.repository';
import { VisitServicesRepository } from '../../persistence/visit-services.repository';
import { type StoredVisit, VisitsRepository } from '../../persistence/visits.repository';
import { VisitLocks } from './visit-locks';
import { computedMoney } from './visit-mapping';
import { VisitPresenter } from './visit-presenter';
import { assertVisitInScope, ownedFilter } from './visit-scope';

/** The timer fields a pause or resume changes, for the audit's before/after. */
const timerOf = ({ status, pausedAt, pausedSeconds }: StoredVisit) => ({
  status,
  pausedAt,
  pausedSeconds,
});

/**
 * The visit lifecycle (docs/modules/clinical.md, spec §VisitsService): start (or resume the
 * patient's live visit), pause, resume, notes, discount, discard and complete, plus the reads. Every
 * mutation re-checks `visit:write`, runs in one `TenantDb` transaction, locks the visit
 * `FOR UPDATE` and refuses unless it is live (409 `visit.not_live`), is audited in that
 * transaction and publishes its event after commit. Actor columns hold the auth user id (W10).
 * The live-visit invariants and the lock order are ADR-0023.
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly visits: VisitsRepository,
    private readonly services: VisitServicesRepository,
    private readonly counters: VisitCountersRepository,
    private readonly procedures: ProceduresRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly worklist: VisitPlanItemsRepository,
    private readonly locks: VisitLocks,
    private readonly presenter: VisitPresenter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Starts a visit in the session's branch, or returns the patient's live visit with
   * `resumed: true` (one live visit per patient, W1). Locks in the ADR-0023 order: the patient
   * `FOR SHARE` (a merge waits), then the per-patient advisory lock (a parallel start waits and
   * then resumes), and only then the visit row. The dentist must be a dentist of the branch; the
   * room an active room of the branch, required when the branch has any (W7). A room another live
   * visit holds → 409 `visit.room_busy`. An archived patient's live visit is still resumed; a new
   * one → 409 `patient.archived`.
   *
   * The visit opens on its type's first step (feature 10, ADR-0044). In the same transaction it
   * gets the services the catalog adds on visits of its type (ADR-0047) and its worklist
   * (ADR-0048): a treatment visit the open plans it was given (422 `visit.plan_invalid` for
   * another) or, given none, the patient's work in progress and urgent plans
   * (`defaultWorklist`); a hygiene visit the patient's open whole-mouth plans; any other type
   * takes none (422 `visit.plans_not_allowed`). A resumed visit ignores the type, the reason and the plans.
   */
  async start(input: StartVisitInput): Promise<StartVisitResult> {
    this.context.requirePermission('visit:write');
    const branchId = this.context.branchId;
    if (!branchId) throw new BranchRequiredError('A visit starts in a branch; choose one first');
    return this.tenantDb.run(async () => {
      const patient = await this.patients.lockForDependentWrite(input.patientId);
      await this.visits.lockPatientStarts(patient.id);
      const existing = await this.visits.findLiveForPatient(patient.id);
      if (existing) {
        if (!inVisitScope(this.context.visitScope(), existing)) {
          throw new VisitLiveElsewhereError('The patient is in another visit already');
        }
        return { visit: await this.presenter.present(existing), resumed: true };
      }
      const planIds = await this.worklistFor(patient.id, input);
      // `lockForDependentWrite` allows archived records (a ledger write-off). A live visit of a
      // patient archived since it started stays resumable; only a new one is refused.
      if (patient.archivedAt !== null) {
        throw new PatientArchivedError(
          'Archived patients cannot start a visit; restore them first',
        );
      }

      await this.assertBranchDentist(branchId, input.dentistId);
      const roomId = await this.roomFor(branchId, input.roomId);
      const tenant = await this.tenancy.currentTenant();
      const now = this.clock.now();
      const userId = this.context.requireUserId();
      const visit = await this.visits.insert({
        displayNumber: await this.counters.nextValue(),
        patientId: patient.id,
        branchId,
        roomId,
        dentistId: input.dentistId,
        startedBy: userId,
        type: input.type,
        currentStep: firstStep(input.type),
        reason: input.reason,
        localDate: localDate(now, tenant.timeZone),
        startedAt: now,
        currency: tenant.currency,
      });
      await this.audit.record({
        action: 'visit.start',
        resourceType: 'visit',
        resourceId: visit.id,
        after: { ...visit, planIds },
      });
      await this.worklist.insert(visit.id, planIds, userId);
      await this.audit.about({ patientId: visit.patientId, visitId: visit.id }, () =>
        this.addAutomaticServices(visit, userId),
      );
      const event: VisitStarted = this.events.create(VISIT_STARTED, {
        visitId: visit.id,
        patientId: visit.patientId,
        dentistId: visit.dentistId,
        roomId: visit.roomId,
        type: visit.type,
      });
      await this.events.publish(event);
      return { visit: await this.presenter.present(visit), resumed: false };
    });
  }

  /**
   * The start popover's defaults (V3): the caller as dentist when they are a dentist of the
   * session's branch, and the room of the last visit they started today while it is still an
   * active room of the branch and no live visit holds it. Nulls without a branch.
   */
  async startDefaults(): Promise<StartDefaults> {
    this.context.requirePermission('visit:write');
    const branchId = this.context.branchId;
    if (!branchId) return { dentistId: null, roomId: null };
    const userId = this.context.requireUserId();
    return this.tenantDb.run(async () => {
      const practitioners = await this.users.listPractitioners({ branchId });
      const caller = practitioners.find((practitioner) => practitioner.userId === userId);
      const tenant = await this.tenancy.currentTenant();
      const lastRoom = await this.visits.lastRoomToday(
        userId,
        localDate(this.clock.now(), tenant.timeZone),
      );
      const roomFree =
        lastRoom !== null &&
        (await this.activeRoomIds(branchId)).includes(lastRoom) &&
        !(await this.visits.isRoomTaken(lastRoom));
      return { dentistId: caller?.id ?? null, roomId: roomFree ? lastRoom : null };
    });
  }

  /** Idempotent: an already paused visit is returned unchanged (no audit, no event). */
  pause(id: string): Promise<VisitResult> {
    return this.change(id, async (before, now) => {
      if (before.status === 'paused') return before;
      const after = await this.visits.update(id, {
        status: transition(before.status, 'pause'),
        pausedAt: now,
      });
      await this.audit.record({
        action: 'visit.pause',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: timerOf(before),
        after: timerOf(after),
      });
      const event: VisitPaused = this.events.create(VISIT_PAUSED, {
        visitId: id,
        patientId: after.patientId,
      });
      await this.events.publish(event);
      return after;
    });
  }

  /**
   * Adds the pause that ends to `pausedSeconds`. Idempotent: a running visit is returned
   * unchanged (no audit, no event).
   */
  resume(id: string): Promise<VisitResult> {
    return this.change(id, async (before, now) => {
      if (before.status === 'in_progress') return before;
      const status = transition(before.status, 'resume');
      const { pausedAt } = before;
      // `visits_paused_consistent`: a paused visit always has `paused_at`.
      if (pausedAt === null) throw new Error(`paused visit ${id} has no paused_at`);
      const after = await this.visits.update(id, {
        status,
        pausedAt: null,
        pausedSeconds: resumePausedSeconds({ pausedAt, pausedSeconds: before.pausedSeconds }, now),
      });
      await this.audit.record({
        action: 'visit.resume',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: timerOf(before),
        after: timerOf(after),
      });
      const event: VisitResumed = this.events.create(VISIT_RESUMED, {
        visitId: id,
        patientId: after.patientId,
      });
      await this.events.publish(event);
      return after;
    });
  }

  /** Last write wins (W6). Unchanged notes change and audit nothing. */
  updateNotes(id: string, input: VisitNotesInput): Promise<VisitResult> {
    return this.change(id, async (before) => {
      if (before.notes === input.notes) return before;
      const after = await this.visits.update(id, { notes: input.notes });
      await this.audit.record({
        action: 'visit.update',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: { notes: before.notes },
        after: { notes: after.notes },
      });
      return after;
    });
  }

  /**
   * Stores the raw entry (a percent or an amount, V7); the cap applies only when the money is
   * computed. Last write wins (W6); an unchanged discount changes and audits nothing. Needs
   * `visit:discount` besides `visit:write` (ADR-0055).
   */
  setDiscount(id: string, input: VisitDiscountInput): Promise<VisitResult> {
    this.context.requirePermission('visit:discount');
    return this.change(id, async (before) => {
      if (
        before.discountMode === input.mode &&
        toCents(before.discountValue) === toCents(input.value)
      ) {
        return before;
      }
      const after = await this.visits.update(id, {
        discountMode: input.mode,
        discountValue: input.value,
      });
      await this.audit.record({
        action: 'visit.update',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: { discountMode: before.discountMode, discountValue: before.discountValue },
        after: { discountMode: after.discountMode, discountValue: after.discountValue },
      });
      return after;
    });
  }

  /**
   * Only an empty visit (spec §Discard, W4), else 409 `visit.not_empty`. The visit becomes
   * `discarded` (which frees its room and hides it from every read) and a paused one loses its
   * `paused_at`. Answers with the discarded visit.
   */
  discard(id: string): Promise<VisitResult> {
    return this.change(id, async (before, now) => {
      const status = transition(before.status, 'discard');
      if (!isDiscardable(await this.visits.discardFacts(id))) {
        throw new VisitNotEmptyError('Only an empty visit can be discarded');
      }
      const after = await this.visits.update(id, {
        status,
        pausedAt: null,
        discardedAt: now,
        discardedBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'visit.discard',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: { status: before.status, pausedAt: before.pausedAt },
        after: {
          status: after.status,
          pausedAt: after.pausedAt,
          discardedAt: after.discardedAt,
          discardedBy: after.discardedBy,
        },
      });
      const event: VisitDiscarded = this.events.create(VISIT_DISCARDED, {
        visitId: id,
        patientId: after.patientId,
        roomId: after.roomId,
      });
      await this.events.publish(event);
      return after;
    });
  }

  /**
   * Completes a live visit (spec §VisitsService, W2, W19). Locks the patient, then the visit
   * (`lockPatientThenVisit`, ADR-0023), and freezes the money computed from its services, the
   * duration (paused time left out; an open pause ends now), `completed_at` and `completed_by`
   * (W10). `VisitCompleted` is published inside the transaction, so `billing`'s in-transaction
   * handler posts the charge before commit: both commit or neither does (ADR-0024). A second call
   * → 409 `visit.not_live`, so a retry can't charge twice. An archived patient's live visit still
   * completes; only a new visit is refused.
   */
  async complete(id: string): Promise<VisitResult> {
    this.context.requirePermission('visit:write');
    return this.tenantDb.run(async () => {
      const before = await this.locks.patientThenVisit(id);
      const status = transition(before.status, 'complete');
      const now = this.clock.now();
      const services = await this.services.listForVisit(id);
      const money = computedMoney(before, services);
      const { pausedAt, startedAt } = before;
      const pausedSeconds =
        pausedAt === null
          ? before.pausedSeconds
          : resumePausedSeconds({ pausedAt, pausedSeconds: before.pausedSeconds }, now);
      const elapsed = elapsedSeconds(
        { startedAt, pausedAt: null, pausedSeconds, completedAt: now },
        now,
      );
      const after = await this.visits.update(id, {
        status,
        pausedAt: null,
        pausedSeconds,
        completedAt: now,
        completedBy: this.context.requireUserId(),
        durationMinutes: durationMinutes(elapsed),
        subtotal: money.subtotal,
        discountAmount: money.discount,
        total: money.total,
      });
      await this.audit.record({
        action: 'visit.complete',
        resourceType: 'visit',
        resourceId: id,
        patientId: before.patientId,
        before: timerOf(before),
        after: {
          ...timerOf(after),
          completedAt: after.completedAt,
          completedBy: after.completedBy,
          durationMinutes: after.durationMinutes,
          subtotal: after.subtotal,
          discountAmount: after.discountAmount,
          total: after.total,
        },
      });
      const event: VisitCompleted = this.events.create(VISIT_COMPLETED, {
        visitId: id,
        patientId: after.patientId,
        currency: after.currency,
        total: money.total,
        localDate: after.localDate,
      });
      await this.events.publish(event);
      return { visit: await this.presenter.present(after) };
    });
  }

  /** A discarded visit → 404 `visit.not_found`, like an unknown one (W4). */
  async get(id: string): Promise<Visit> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const visit = await this.visits.findById(id);
      if (!visit) throw new VisitNotFoundError('Visit not found');
      assertVisitInScope(this.context, visit);
      return this.presenter.present(visit);
    });
  }

  /**
   * Live visits, oldest first, optionally of one patient, within the caller's visit scope
   * (ADR-0055). `mine` (W18): the caller is the dentist (through their staff profile) or started
   * the visit; a platform admin has no staff profile in the tenant, so only their own starts
   * count. Names come from `patients` and `users`.
   */
  async live(query: LiveVisitQuery): Promise<LiveVisitRef[]> {
    this.context.requirePermission('visit:read');
    const userId = this.context.requireUserId();
    const scoped = ownedFilter(this.context);
    if (scoped === null) return [];
    const own = query.mine ? { userId, profileId: this.context.staffProfileId } : scoped;
    return this.tenantDb.run(async () => {
      const visits = await this.visits.liveRefs({ patientId: query.patientId, own });
      if (visits.length === 0) return [];
      const patientNames = new Map(
        (await this.patients.getMany(visits.map((visit) => visit.patientId))).map((patient) => [
          patient.id,
          patient.fullName,
        ]),
      );
      const dentistNames = new Map(
        (await this.users.practitionersByProfileIds(visits.map((visit) => visit.dentistId))).map(
          (practitioner) => [practitioner.id, practitioner.displayName],
        ),
      );
      const serverNow = this.clock.now().toISOString();
      return visits.map((visit) => ({
        id: visit.id,
        patientId: visit.patientId,
        patientName: patientNames.get(visit.patientId) ?? '',
        dentistName: dentistNames.get(visit.dentistId) ?? '',
        type: visit.type,
        currentStep: visit.currentStep,
        status: visit.status,
        startedAt: visit.startedAt.toISOString(),
        pausedAt: visit.pausedAt?.toISOString() ?? null,
        pausedSeconds: visit.pausedSeconds,
        serverNow,
      }));
    });
  }

  /**
   * One lifecycle mutation: `visit:write`, one transaction, the visit locked `FOR UPDATE` and
   * live (`lockLive`), then `work`, which audits and publishes when it changes anything.
   */
  private async change(
    id: string,
    work: (before: StoredVisit, now: Date) => Promise<StoredVisit>,
  ): Promise<VisitResult> {
    this.context.requirePermission('visit:write');
    return this.tenantDb.run(async () => {
      const before = await this.visits.lockLive(id);
      assertVisitInScope(this.context, before);
      const after = await work(before, this.clock.now());
      return { visit: await this.presenter.present(after) };
    });
  }

  /** The open plans a new visit takes on (ADR-0048); see `start`. */
  private async worklistFor(patientId: string, input: StartVisitInput): Promise<string[]> {
    const named = input.planIds ?? [];
    if (input.type !== 'treatment' && named.length > 0) {
      throw new VisitPlansNotAllowedError('Only a treatment visit takes planned work on at start');
    }
    if (input.type !== 'treatment' && input.type !== 'hygiene') return [];
    const open = await this.plans.listOpenForPatient(patientId);
    if (input.type === 'hygiene') {
      return open.filter((plan) => plan.chargeUnit === 'per_mouth').map((plan) => plan.id);
    }
    // Nobody chose: the work in progress and what is urgent. The rest is ticked in the visit.
    if (input.planIds === undefined) return defaultWorklist(open).map((plan) => plan.id);
    const openIds = new Set(open.map((plan) => plan.id));
    if (named.some((planId) => !openIds.has(planId))) {
      throw new VisitPlanInvalidError("Pick among the patient's open planned treatments");
    }
    return named;
  }

  /**
   * The services the catalog adds on visits of this type (ADR-0047), at their catalog price, as
   * ordinary services of the visit marked `auto_added`: removable, and not visit content until
   * someone edits them. One priced in another currency than the visit's is left out (W12).
   */
  private async addAutomaticServices(visit: StoredVisit, userId: string): Promise<void> {
    if (visit.type === 'treatment') return;
    for (const item of await this.procedures.addedOn(visit.type)) {
      if (item.price.currency !== visit.currency) continue;
      const service = await this.services.insert({
        visitId: visit.id,
        procedureId: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        chargeUnit: item.chargeUnit,
        toothCode: null,
        jaw: null,
        surfaces: [],
        baseAmount: item.price.amount,
        planId: null,
        autoAdded: true,
        recordedBy: userId,
      });
      await this.audit.record({
        action: 'visit_service.create',
        resourceType: 'visit_service',
        resourceId: service.id,
        after: service,
      });
    }
  }

  /** An active dentist-type practitioner assigned to the branch (ADR-0020), else 422. */
  private async assertBranchDentist(branchId: string, dentistId: string): Promise<void> {
    const practitioners = await this.users.listPractitioners({ branchId });
    if (!practitioners.some((practitioner) => practitioner.id === dentistId)) {
      throw new DentistInvalidError('The dentist must be a dentist of this branch');
    }
  }

  /** The visit's room per W7: required iff the branch has active rooms, and one of them. */
  private async roomFor(branchId: string, roomId: string | undefined): Promise<string | null> {
    const active = await this.activeRoomIds(branchId);
    if (roomId === undefined) {
      if (active.length > 0) throw new RoomRequiredError('Choose the room for this visit');
      return null;
    }
    if (!active.includes(roomId)) {
      throw new RoomInvalidError('The room must be an active room of this branch');
    }
    return roomId;
  }

  private async activeRoomIds(branchId: string): Promise<string[]> {
    return (await this.tenancy.listRooms(branchId))
      .filter((room) => room.active)
      .map((room) => room.id);
  }
}
