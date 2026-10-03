import {
  type AmendVisitInput,
  durationMinutes,
  lineFinal,
  surfacesSchema,
  toothCodeSchema,
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
  type VisitFilters,
  type VisitListItem,
  type VisitListQuery,
  type VisitListSummary,
  type VisitListTab,
  type VisitPage,
  type VisitStats,
  type VisitStatus,
  type VoidVisitInput,
  patientListQuerySchema,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { AuditService } from '../../audit';
import { PatientArchivedError, PatientMergedError, PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { isDiscardable } from '../domain/discard-rule';
import { type AmendableService, planAmendment } from '../domain/visit-amendment';
import {
  BranchRequiredError,
  DentistInvalidError,
  RoomInvalidError,
  RoomRequiredError,
  VisitMovedError,
  VisitNotEmptyError,
  VisitNotFoundError,
  VisitStaleError,
} from '../domain/visit-errors';
import { decodeVisitCursor, encodeVisitCursor } from '../domain/visit-cursor';
import { correct, LIVE_VISIT_STATUSES, transition } from '../domain/visit-lifecycle';
import { addDays, rangeStart } from '../domain/visit-range';
import { elapsedSeconds, resumePausedSeconds } from '../domain/visit-timer';
import {
  VISIT_AMENDED,
  VISIT_COMPLETED,
  VISIT_DISCARDED,
  VISIT_PAUSED,
  VISIT_RESUMED,
  VISIT_STARTED,
  VISIT_VOIDED,
  type VisitAmended,
  type VisitCompleted,
  type VisitDiscarded,
  type VisitPaused,
  type VisitResumed,
  type VisitStarted,
  type VisitVoided,
} from '../events/visit-events';
import { VisitAmendmentsRepository } from '../persistence/visit-amendments.repository';
import { VisitCountersRepository } from '../persistence/visit-counters.repository';
import {
  type StoredVisitService,
  VisitServicesRepository,
} from '../persistence/visit-services.repository';
import type { VisitCriteria, VisitTextMatch } from '../persistence/visit-search.sql';
import { type StoredVisit, VisitsRepository } from '../persistence/visits.repository';
import { PlanUnperformer } from './plan-unperformer';
import { computedMoney, moneyOf, toVisit, toVisitService } from './visit-mapping';

/** A stored service as `planAmendment` sees it (the table's CHECKs admit the contract's values). */
const toAmendable = (service: StoredVisitService): AmendableService => ({
  id: service.id,
  code: service.code,
  name: service.name,
  chargeUnit: service.chargeUnit,
  toothCode: service.toothCode === null ? null : toothCodeSchema.parse(service.toothCode),
  surfaces: surfacesSchema.parse(service.surfaces),
  baseAmount: service.baseAmount,
  discountAmount: service.discountAmount,
  planId: service.planId,
});

/** Options only other modules' services pass (`billing`'s Unpaid tab), never over HTTP. */
export interface VisitSearchInternal {
  /** Restricts the list to these visits; an empty list matches nothing. */
  idsIn?: readonly string[];
}

/** Which statuses each tab lists; discarded visits never appear (D11). */
const TAB_STATUSES: Record<VisitListTab, readonly VisitStatus[]> = {
  all: ['in_progress', 'paused', 'completed', 'amended', 'voided'],
  in_progress: LIVE_VISIT_STATUSES,
  voided_amended: ['amended', 'voided'],
  history: ['completed', 'amended', 'voided'],
};

/** `V-123`, `v123` or `123` (leading zeros allowed) reads as a visit number. */
const VISIT_NUMBER_QUERY = /^(?:v-?)?0*(\d{1,9})$/i;

/** D8: the client's `expectedUpdatedAt` must be the visit's current `updated_at`. */
function assertFresh(visit: StoredVisit, expectedUpdatedAt: string): void {
  if (visit.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new VisitStaleError('The visit changed since you opened it; reload and try again');
  }
}

/** The timer fields a pause or resume changes, for the audit's before/after. */
const timerOf = ({ status, pausedAt, pausedSeconds }: StoredVisit) => ({
  status,
  pausedAt,
  pausedSeconds,
});

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
    private readonly amendments: VisitAmendmentsRepository,
    private readonly unperformer: PlanUnperformer,
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
   */
  async start(input: StartVisitInput): Promise<StartVisitResult> {
    this.context.requirePermission('visit:write');
    const branchId = this.context.branchId;
    if (!branchId) throw new BranchRequiredError('A visit starts in a branch; choose one first');
    return this.tenantDb.run(async () => {
      const patient = await this.patients.lockForDependentWrite(input.patientId);
      await this.visits.lockPatientStarts(patient.id);
      const existing = await this.visits.findLiveForPatient(patient.id);
      if (existing) return { visit: await this.toVisit(existing), resumed: true };
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
      const visit = await this.visits.insert({
        displayNumber: await this.counters.nextValue(),
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
      const before = await this.lockPatientThenVisit(id);
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
      return { visit: toVisit(after, services, now) };
    });
  }

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
    return this.tenantDb.run(async () => {
      const before = await this.lockPatientThenVisit(id, (visitId) =>
        this.visits.lockForCorrection(visitId),
      );
      const status = correct(before.status, 'amend');
      assertFresh(before, input.expectedUpdatedAt);
      const plan = planAmendment(
        {
          discountMode: before.discountMode,
          discountValue: before.discountValue,
          services: (await this.services.listForVisit(id)).map(toAmendable),
        },
        input,
      );
      const now = this.clock.now();
      for (const service of plan.removed) {
        await this.services.update(service.id, { deletedAt: now });
      }
      for (const { id: serviceId, toothCode, surfaces } of plan.edited) {
        await this.services.update(serviceId, { toothCode, surfaces });
      }
      for (const planId of plan.plansToReopen) {
        await this.unperformer.unperform(planId, before, input.reason);
      }
      const after = await this.visits.update(id, {
        status,
        discountMode: input.discount.mode,
        discountValue: input.discount.value,
        subtotal: plan.after.subtotal,
        discountAmount: plan.after.discountAmount,
        total: plan.after.total,
      });
      const amendmentId = await this.amendments.append({
        visitId: id,
        reason: input.reason,
        before: plan.before,
        after: plan.after,
        delta: plan.delta,
        currency: before.currency,
        amendedBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'visit.amend',
        resourceType: 'visit',
        resourceId: id,
        before: plan.before,
        after: plan.after,
        reason: input.reason,
      });
      const event: VisitAmended = this.events.create(VISIT_AMENDED, {
        visitId: id,
        patientId: after.patientId,
        amendmentId,
        currency: after.currency,
        delta: plan.delta,
        reason: input.reason,
      });
      await this.events.publish(event);
      return { visit: await this.toVisit(after) };
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
      const before = await this.lockPatientThenVisit(id, (visitId) =>
        this.visits.lockForCorrection(visitId),
      );
      const status = correct(before.status, 'void');
      assertFresh(before, input.expectedUpdatedAt);
      const after = await this.visits.update(id, {
        status,
        voidedAt: this.clock.now(),
        voidedBy: this.context.requireUserId(),
        voidReason: input.reason,
      });
      await this.audit.record({
        action: 'visit.void',
        resourceType: 'visit',
        resourceId: id,
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
      return { visit: await this.toVisit(after) };
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
        ? { userId, profileId: await this.users.profileIdOf(userId) }
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

  /**
   * The visits list (4b, spec §VisitsService), cursor-paged newest first: the session branch's
   * visits, or with `patientId` one patient's in every branch; never discarded ones. No branch in
   * the session (and no patient) → an empty page. `internal.idsIn` is `billing`'s Unpaid tab.
   * Each row carries its patient, dentist, room, services, money (computed while live) and
   * amendment count.
   */
  async search(query: VisitListQuery, internal: VisitSearchInternal = {}): Promise<VisitPage> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const criteria = await this.criteriaFor(query, internal);
      if (!criteria) return { items: [], nextCursor: null };
      const after = query.cursor === undefined ? undefined : decodeVisitCursor(query.cursor);
      const rows = await this.visits.page(criteria, after, query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: await this.listItems(page),
        nextCursor:
          rows.length > query.limit && last
            ? encodeVisitCursor({ startedAt: last.startedAt, id: last.id })
            : null,
      };
    });
  }

  /** The list footer and tab chips for the same filters (D12); see `VisitListSummary`. */
  async summary(query: VisitFilters): Promise<VisitListSummary> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const criteria = await this.criteriaFor(query, {});
      if (!criteria) {
        return {
          count: 0,
          billed: [],
          tabs: { all: 0, inProgress: 0, voidedAmended: 0, today: 0 },
        };
      }
      return {
        ...(await this.visits.aggregate(criteria)),
        tabs: await this.visits.tabCounts(criteria.scope, await this.today()),
      };
    });
  }

  /** Count and billed sums of the matching visits among `internal.idsIn` (`billing`'s Unpaid). */
  async aggregate(
    query: VisitFilters,
    internal: VisitSearchInternal,
  ): Promise<{ count: number; billed: { currency: string; amount: string }[] }> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const criteria = await this.criteriaFor(query, internal);
      return criteria ? this.visits.aggregate(criteria) : { count: 0, billed: [] };
    });
  }

  /**
   * Last visit and visit count per patient (D18: counted visits only, any branch), in input
   * order; a patient without visits gets `lastVisitDate: null` and 0.
   */
  async lastVisitFor(patientIds: readonly string[]): Promise<VisitStats> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () => {
      const stats = new Map(
        (await this.visits.statsFor(patientIds)).map((row) => [row.patientId, row]),
      );
      return [...new Set(patientIds)].map((patientId) => ({
        patientId,
        lastVisitDate: stats.get(patientId)?.lastVisitDate ?? null,
        visitCount: stats.get(patientId)?.visitCount ?? 0,
      }));
    });
  }

  /**
   * Patients with a counted visit on or after the day `days` days before the tenant's today — or
   * ever, with `days: null` — for the patients list's *Not seen* view and *Never* filter (D18).
   */
  async patientIdsSeenWithin(days: number | null): Promise<string[]> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(async () =>
      this.visits.patientIdsSeenSince(days === null ? null : addDays(await this.today(), -days)),
    );
  }

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
   * For `billing`'s receipts, histories and statements (feature 5): each visit's display number
   * and local date, in no particular order; unknown ids are absent.
   */
  async numbersFor(
    visitIds: readonly string[],
  ): Promise<{ visitId: string; displayNumber: number; localDate: string }[]> {
    this.context.requirePermission('visit:read');
    return this.tenantDb.run(() => this.visits.numbersFor([...new Set(visitIds)]));
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

  // --- Shared rules ---

  /**
   * The ADR-0023 lock order for a mutation that involves the patient: the visit's patient
   * `FOR SHARE` (`lockForDependentWrite`, so a merge waits), then the visit `FOR UPDATE` through
   * `lock` — live (`lockLive`) by default, any status for amend and void. A merge that committed between the unlocked read and the patient lock has
   * re-pointed the visit (W24): the patient read first is merged away, and the visit is read
   * again, once.
   */
  private async lockPatientThenVisit(
    id: string,
    lock: (visitId: string) => Promise<StoredVisit> = (visitId) => this.visits.lockLive(visitId),
    retried = false,
  ): Promise<StoredVisit> {
    const snapshot = await this.visits.findById(id);
    if (!snapshot) throw new VisitNotFoundError('Visit not found');
    try {
      await this.patients.lockForDependentWrite(snapshot.patientId);
    } catch (error) {
      if (retried || !(error instanceof PatientMergedError)) throw error;
      return this.lockPatientThenVisit(id, lock, true);
    }
    const visit = await lock(id);
    // Defensive only: should be unreachable since E3 re-points a visit inside the same
    // transaction that locks its old patient `FOR UPDATE`, which our `FOR SHARE` lock above
    // either blocks until we commit, or — if that merge already committed — makes
    // `lockForDependentWrite` throw `PatientMergedError` first (the branch above). If this still
    // fires, retry by throwing instead of recursing: recursing here would lock a new patient
    // while still holding this visit's `FOR UPDATE` lock, inverting the ADR-0023 lock order.
    if (visit.patientId !== snapshot.patientId) {
      throw new VisitMovedError('The visit moved to another patient; retry');
    }
    return visit;
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
      const after = await work(await this.visits.lockLive(id), this.clock.now());
      return { visit: await this.toVisit(after) };
    });
  }

  private async today(): Promise<string> {
    return localDate(this.clock.now(), (await this.tenancy.currentTenant()).timeZone);
  }

  /**
   * The list query resolved to repository criteria: scope (null without a branch or patient),
   * the tab's statuses, the date filter from the tenant's today, and `q` as a visit number, a
   * service, or the patients it finds (active and archived).
   */
  private async criteriaFor(
    query: VisitFilters,
    internal: VisitSearchInternal,
  ): Promise<VisitCriteria | null> {
    const branchId = this.context.branchId;
    const scope =
      query.patientId !== undefined
        ? { patientId: query.patientId }
        : branchId
          ? { branchId }
          : null;
    if (!scope) return null;
    return {
      scope,
      statuses: TAB_STATUSES[query.tab],
      fromDate: rangeStart(query.range, await this.today()) ?? undefined,
      dentistId: query.dentistId,
      roomId: query.roomId,
      match: query.q === undefined ? undefined : await this.textMatch(query.q),
      idsIn: internal.idsIn,
    };
  }

  private async textMatch(q: string): Promise<VisitTextMatch> {
    const number = VISIT_NUMBER_QUERY.exec(q)?.[1];
    const patientIds = (
      await Promise.all(
        (['active', 'archived'] as const).map((view) =>
          this.patients.searchIds(patientListQuerySchema.parse({ q, view })),
        ),
      )
    ).flat();
    return {
      displayNumber: number === undefined ? undefined : Number(number),
      text: q,
      patientIds,
    };
  }

  /** List rows for `visits` (one page), with everything the list and the detail panel show. */
  private async listItems(visits: StoredVisit[]): Promise<VisitListItem[]> {
    if (visits.length === 0) return [];
    const ids = visits.map((visit) => visit.id);
    const services = await this.services.listForVisits(ids);
    const amendmentCounts = await this.amendments.countsFor(ids);
    const patients = new Map(
      (await this.patients.listItemsByIds(visits.map((visit) => visit.patientId))).map(
        (patient) => [patient.id, patient],
      ),
    );
    const dentists = new Map(
      (await this.users.practitionersByProfileIds(visits.map((visit) => visit.dentistId))).map(
        (practitioner) => [practitioner.id, practitioner.displayName],
      ),
    );
    const rooms = new Map((await this.tenancy.listRooms()).map((room) => [room.id, room.name]));
    const now = this.clock.now().toISOString();
    return visits.map((visit) => {
      const own = services.filter((service) => service.visitId === visit.id);
      const money = moneyOf(visit, own);
      const patient = patients.get(visit.patientId);
      return {
        id: visit.id,
        displayNumber: visit.displayNumber,
        status: visit.status,
        localDate: visit.localDate,
        startedAt: visit.startedAt.toISOString(),
        completedAt: visit.completedAt?.toISOString() ?? null,
        durationMinutes: visit.durationMinutes,
        pausedAt: visit.pausedAt?.toISOString() ?? null,
        pausedSeconds: visit.pausedSeconds,
        branchId: visit.branchId,
        room:
          visit.roomId === null ? null : { id: visit.roomId, name: rooms.get(visit.roomId) ?? '' },
        patient: {
          id: visit.patientId,
          displayNumber: patient?.displayNumber ?? '',
          fullName: patient?.fullName ?? '',
        },
        dentist: { id: visit.dentistId, name: dentists.get(visit.dentistId) ?? '' },
        services: own.map((service) => {
          const line = toVisitService(service, visit.currency);
          return {
            id: line.id,
            code: line.code,
            name: line.name,
            chargeUnit: line.chargeUnit,
            toothCode: line.toothCode,
            surfaces: line.surfaces,
            planId: line.planId,
            final: line.final,
          };
        }),
        notes: visit.notes,
        discount: { mode: visit.discountMode, value: visit.discountValue },
        currency: visit.currency,
        subtotal: money.subtotal,
        discountAmount: money.discount,
        total: money.total,
        amendmentCount: amendmentCounts.get(visit.id) ?? 0,
        voidedAt: visit.voidedAt?.toISOString() ?? null,
        voidReason: visit.voidReason,
        updatedAt: visit.updatedAt.toISOString(),
        serverNow: now,
      };
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
