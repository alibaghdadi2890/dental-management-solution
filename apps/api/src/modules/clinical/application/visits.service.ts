import {
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
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { AuditService } from '../../audit';
import { PatientArchivedError, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { isDiscardable } from '../domain/discard-rule';
import {
  BranchRequiredError,
  DentistInvalidError,
  RoomInvalidError,
  RoomRequiredError,
  VisitNotEmptyError,
  VisitNotFoundError,
} from '../domain/visit-errors';
import { transition } from '../domain/visit-lifecycle';
import { resumePausedSeconds } from '../domain/visit-timer';
import {
  VISIT_DISCARDED,
  VISIT_PAUSED,
  VISIT_RESUMED,
  VISIT_STARTED,
  type VisitDiscarded,
  type VisitPaused,
  type VisitResumed,
  type VisitStarted,
} from '../events/visit-events';
import { VisitServicesRepository } from '../persistence/visit-services.repository';
import { type StoredVisit, VisitsRepository } from '../persistence/visits.repository';
import { toVisit } from './visit-mapping';

/** The timer fields a pause or resume changes, for the audit's before/after. */
const timerOf = ({ status, pausedAt, pausedSeconds }: StoredVisit) => ({
  status,
  pausedAt,
  pausedSeconds,
});

/**
 * The visit lifecycle (docs/modules/clinical.md, spec §VisitsService): start (or resume the
 * patient's live visit), pause, resume, notes, discount and discard, plus the reads. Every
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
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Starts a visit in the session's branch, or returns the patient's live visit with
   * `resumed: true` (one live visit per patient, W1). Locks in the ADR-0023 order: the patient
   * `FOR SHARE` (a merge waits), then the per-patient advisory lock (a parallel start waits and
   * then resumes), and only then the visit row. The dentist must be a dentist of the branch; the
   * room an active room of the branch, required when the branch has any (W7). A room another live
   * visit holds → 409 `visit.room_busy`.
   */
  async start(input: StartVisitInput): Promise<StartVisitResult> {
    this.context.requirePermission('visit:write');
    const branchId = this.context.branchId;
    if (!branchId) throw new BranchRequiredError('A visit starts in a branch; choose one first');
    return this.tenantDb.run(async () => {
      const patient = await this.patients.lockForDependentWrite(input.patientId);
      // `lockForDependentWrite` allows archived records (a ledger write-off); a visit doesn't.
      if (patient.archivedAt !== null) {
        throw new PatientArchivedError(
          'Archived patients cannot start a visit; restore them first',
        );
      }
      await this.visits.lockPatientStarts(patient.id);
      const existing = await this.visits.findLiveForPatient(patient.id);
      if (existing) return { visit: await this.toVisit(existing), resumed: true };

      await this.assertBranchDentist(branchId, input.dentistId);
      const roomId = await this.roomFor(branchId, input.roomId);
      const tenant = await this.tenancy.currentTenant();
      const now = this.clock.now();
      const visit = await this.visits.insert({
        patientId: patient.id,
        branchId,
        roomId,
        dentistId: input.dentistId,
        startedBy: this.context.requireUserId(),
        localDate: localDate(now, tenant.timeZone),
        startedAt: now,
        currency: tenant.currency,
      });
      await this.audit.record({
        action: 'visit.start',
        resourceType: 'visit',
        resourceId: visit.id,
        after: visit,
      });
      const event: VisitStarted = this.events.create(VISIT_STARTED, {
        visitId: visit.id,
        patientId: visit.patientId,
        dentistId: visit.dentistId,
        roomId: visit.roomId,
      });
      await this.events.publish(event);
      return { visit: toVisit(visit, [], now), resumed: false };
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
        before: { notes: before.notes },
        after: { notes: after.notes },
      });
      return after;
    });
  }

  /**
   * Stores the raw entry (a percent or an amount, V7); the cap applies only when the money is
   * computed. Last write wins (W6); an unchanged discount changes and audits nothing.
   */
  setDiscount(id: string, input: VisitDiscountInput): Promise<VisitResult> {
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
        before: { status: before.status },
        after: {
          status: after.status,
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

  /** A discarded visit → 404 `visit.not_found`, like an unknown one (W4). */
  async get(id: string): Promise<Visit> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const visit = await this.visits.findById(id);
      if (!visit) throw new VisitNotFoundError('Visit not found');
      return this.toVisit(visit);
    });
  }

  /**
   * Live visits, oldest first, optionally of one patient. `mine` (W18): the caller is the dentist
   * (through their staff profile) or started the visit; a platform admin has no staff profile in
   * the tenant, so only their own starts count. Names come from `patients` and `users`.
   */
  async live(query: LiveVisitQuery): Promise<LiveVisitRef[]> {
    this.context.requirePermission('visit:read');
    const userId = this.context.requireUserId();
    return this.tenantDb.run(async () => {
      const mine = query.mine
        ? {
            userId,
            profileId: this.context.isPlatformAdmin
              ? null
              : (await this.users.get(userId)).profileId,
          }
        : undefined;
      const visits = await this.visits.liveRefs({ patientId: query.patientId, mine });
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
        status: visit.status,
        startedAt: visit.startedAt.toISOString(),
        pausedAt: visit.pausedAt?.toISOString() ?? null,
        pausedSeconds: visit.pausedSeconds,
        serverNow,
      }));
    });
  }

  // --- Shared rules ---

  /**
   * One lifecycle mutation: `visit:write`, one transaction, the visit locked `FOR UPDATE` and
   * live (`lockLive`), then `work`, which audits and publishes when it changes anything.
   */
  private change(
    id: string,
    work: (before: StoredVisit, now: Date) => Promise<StoredVisit>,
  ): Promise<VisitResult> {
    this.context.requirePermission('visit:write');
    return this.tenantDb.run(async () => {
      const after = await work(await this.visits.lockLive(id), this.clock.now());
      return { visit: await this.toVisit(after) };
    });
  }

  private async toVisit(visit: StoredVisit): Promise<Visit> {
    return toVisit(visit, await this.services.listForVisit(visit.id), this.clock.now());
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
