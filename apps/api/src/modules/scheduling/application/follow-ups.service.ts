import {
  type DeclineFollowUp,
  type FollowUp,
  followUpDueOn,
  type FollowUpListQuery,
  followUpWindowFrom,
  type NextAppointmentPayload,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { AuditService } from '../../audit';
import { VisitFactsService } from '../../clinical';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import {
  compareWorklist,
  deriveFollowUp,
  invalidReasonOf,
  reopenedWindowFrom,
} from '../domain/follow-up-dates';
import { FollowUpNotAwaitingError } from '../domain/scheduling-errors';
import {
  FOLLOW_UP_BOOKED,
  FOLLOW_UP_DECLINED,
  FOLLOW_UP_RECOMMENDED,
  FOLLOW_UP_REOPENED,
  FOLLOW_UP_TAGGED,
  type FollowUpBooked,
  type FollowUpDeclined,
  type FollowUpRecommended,
  type FollowUpReopened,
  type FollowUpTagged,
} from '../events/scheduling-events';
import { AppointmentsRepository } from '../persistence/appointments.repository';
import { FollowUpsRepository, type StoredFollowUp } from '../persistence/follow-ups.repository';
import { OpeningHoursRepository } from '../persistence/opening-hours.repository';

export interface CompletionFacts {
  visitId: string;
  patientId: string;
  branchId: string;
  dentistId: string;
  displayNumber: number;
  localDate: string;
}

const PATIENT_ARCHIVED_REASON = 'Patient archived';

/** The dentist's next step for the patient (ADR-0069): worklist, outcomes and reopening. */
@Injectable()
export class FollowUpsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly followUps: FollowUpsRepository,
    private readonly appointments: AppointmentsRepository,
    private readonly settings: OpeningHoursRepository,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    private readonly visitFacts: VisitFactsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Awaiting and in the window, overdue first (A16). Expired ones are not listed. */
  worklist(query: FollowUpListQuery): Promise<FollowUp[]> {
    this.context.requirePermission('appointment:write_all');
    return this.tenantDb.run(async () => {
      const rows = await this.followUps.awaitingInBranch(query.branchId);
      const all = await this.present([...rows].sort(compareWorklist));
      return all.filter((followUp) => !followUp.expired);
    });
  }

  forPatient(patientId: string): Promise<FollowUp[]> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () => this.present(await this.followUps.forPatient(patientId)));
  }

  markWillCall(id: string): Promise<FollowUp> {
    this.context.requirePermission('appointment:write_all');
    return this.tenantDb.run(async () => {
      const before = await this.lockAwaiting(id);
      const after = await this.followUps.update(id, {
        willCallBy: this.context.requireUserId(),
        willCallAt: this.clock.now(),
      });
      await this.audit.record({
        action: 'follow_up.will_call',
        resourceType: 'follow_up',
        resourceId: id,
        patientId: after.patientId,
        visitId: after.sourceVisitId,
        before: { willCallAt: before.willCallAt },
        after: { willCallAt: after.willCallAt, title: after.title },
      });
      const event: FollowUpTagged = this.events.create(FOLLOW_UP_TAGGED, {
        followUpId: id,
        patientId: after.patientId,
      });
      await this.events.publish(event);
      return this.presentOne(after);
    });
  }

  decline(id: string, input: DeclineFollowUp): Promise<FollowUp> {
    this.context.requirePermission('appointment:write_all');
    return this.tenantDb.run(async () => {
      await this.lockAwaiting(id);
      return this.presentOne(await this.declineRow(id, input.reason));
    });
  }

  /** `VisitCompleted`, in its transaction (A15). `appointmentId`: it is already booked. */
  async recommend(
    payload: NextAppointmentPayload,
    facts: CompletionFacts,
    appointmentId: string | null,
  ): Promise<StoredFollowUp> {
    const dueOn = followUpDueOn(payload.timing, facts.localDate, payload.customDate);
    const created = await this.followUps.insert({
      branchId: facts.branchId,
      patientId: facts.patientId,
      sourceVisitId: facts.visitId,
      sourceVisitNumber: facts.displayNumber,
      recommendedBy: facts.dentistId,
      preferredDentistId: payload.preferredDentistId ?? facts.dentistId,
      kind: payload.kind,
      title: payload.title,
      planIds: payload.planIds,
      priority: payload.priority,
      sessionNumber: payload.sessionNumber,
      sessionTotal: payload.sessionTotal,
      durationMin: payload.durationMin,
      timing: payload.timing,
      customDate: payload.customDate,
      visitDate: facts.localDate,
      dueOn,
      windowFrom: followUpWindowFrom(dueOn, facts.localDate),
      note: payload.note,
      clinicalPrep: payload.clinicalPrep,
      status: appointmentId ? 'booked' : 'awaiting',
      createdBy: this.context.requireUserId(),
    });
    await this.audit.record({
      action: 'follow_up.recommend',
      resourceType: 'follow_up',
      resourceId: created.id,
      patientId: created.patientId,
      visitId: created.sourceVisitId,
      after: {
        title: created.title,
        kind: created.kind,
        timing: created.timing,
        dueOn: created.dueOn,
        status: created.status,
      },
    });
    const event: FollowUpRecommended = this.events.create(FOLLOW_UP_RECOMMENDED, {
      followUpId: created.id,
      patientId: created.patientId,
      visitId: created.sourceVisitId,
    });
    await this.events.publish(event);
    if (appointmentId) await this.recordBooked(created, appointmentId);
    return created;
  }

  /** Before a booking inserts: locks it, as someone else may have just booked it. */
  async lockForBooking(id: string, patientId: string): Promise<void> {
    const followUp = await this.lockAwaiting(id);
    if (followUp.patientId !== patientId) throw new FollowUpNotAwaitingError(id);
  }

  /** The booking took it off the list. */
  async markBooked(id: string, appointmentId: string): Promise<void> {
    const after = await this.followUps.update(id, { status: 'booked' });
    await this.recordBooked(after, appointmentId);
  }

  private async recordBooked(followUp: StoredFollowUp, appointmentId: string): Promise<void> {
    await this.audit.record({
      action: 'follow_up.book',
      resourceType: 'follow_up',
      resourceId: followUp.id,
      patientId: followUp.patientId,
      visitId: followUp.sourceVisitId,
      after: { title: followUp.title, appointmentId },
    });
    const event: FollowUpBooked = this.events.create(FOLLOW_UP_BOOKED, {
      followUpId: followUp.id,
      patientId: followUp.patientId,
      appointmentId,
    });
    await this.events.publish(event);
  }

  /** Cancel and no-show put it back on the list, with a fresh window (G6, G7). */
  async reopen(id: string): Promise<void> {
    const before = await this.followUps.lock(id);
    if (before.status !== 'booked') return;
    const { timeZone } = await this.tenancy.currentTenant();
    const today = localDate(this.clock.now(), timeZone);
    const after = await this.followUps.update(id, {
      status: 'awaiting',
      windowFrom: reopenedWindowFrom(before.windowFrom, today),
      willCallAt: null,
      willCallBy: null,
    });
    await this.audit.record({
      action: 'follow_up.reopen',
      resourceType: 'follow_up',
      resourceId: id,
      patientId: after.patientId,
      visitId: after.sourceVisitId,
      before: { status: before.status },
      after: { status: after.status, title: after.title },
    });
    const event: FollowUpReopened = this.events.create(FOLLOW_UP_REOPENED, {
      followUpId: id,
      patientId: after.patientId,
    });
    await this.events.publish(event);
  }

  /** Its appointment completed. */
  async markDone(id: string): Promise<void> {
    await this.followUps.update(id, { status: 'done' });
  }

  /** G15: with no upcoming appointment left, nothing is left to book for an archived patient. */
  async declineAwaitingOfArchived(patientId: string): Promise<void> {
    for (const followUp of await this.followUps.awaitingForPatient(patientId)) {
      await this.declineRow(followUp.id, PATIENT_ARCHIVED_REASON);
    }
  }

  repointPatient(droppedId: string, keptId: string): Promise<void> {
    return this.followUps.repointPatient(droppedId, keptId);
  }

  private async declineRow(id: string, reason: string | null): Promise<StoredFollowUp> {
    const after = await this.followUps.update(id, {
      status: 'declined',
      declinedBy: this.context.requireUserId(),
      declinedAt: this.clock.now(),
      declinedReason: reason,
    });
    await this.audit.record({
      action: 'follow_up.decline',
      resourceType: 'follow_up',
      resourceId: id,
      patientId: after.patientId,
      visitId: after.sourceVisitId,
      reason: reason ?? undefined,
      after: { status: after.status, title: after.title },
    });
    const event: FollowUpDeclined = this.events.create(FOLLOW_UP_DECLINED, {
      followUpId: id,
      patientId: after.patientId,
    });
    await this.events.publish(event);
    return after;
  }

  private async lockAwaiting(id: string): Promise<StoredFollowUp> {
    const followUp = await this.followUps.lock(id);
    if (followUp.status !== 'awaiting') throw new FollowUpNotAwaitingError(id);
    return followUp;
  }

  private async presentOne(row: StoredFollowUp): Promise<FollowUp> {
    const [followUp] = await this.present([row]);
    if (!followUp) throw new Error('presenting a follow-up returned nothing');
    return followUp;
  }

  private async present(rows: readonly StoredFollowUp[]): Promise<FollowUp[]> {
    if (rows.length === 0) return [];
    const { timeZone } = await this.tenancy.currentTenant();
    const today = localDate(this.clock.now(), timeZone);
    const windowDays = await this.settings.windowDays();
    const dentistIds = rows.flatMap((row) =>
      row.preferredDentistId ? [row.recommendedBy, row.preferredDentistId] : [row.recommendedBy],
    );
    const dentists = new Map(
      (await this.users.practitionersByProfileIds(dentistIds)).map((item) => [
        item.id,
        item.displayName,
      ]),
    );
    const patients = new Map(
      (await this.patients.refs(rows.map((row) => row.patientId))).map((item) => [item.id, item]),
    );
    const holders = await this.appointments.holdersOf(rows.map((row) => row.id));
    const plans = await this.visitFacts.planStatuses(rows.flatMap((row) => row.planIds));
    const taggers = await this.users.namesByUserIds(
      rows.flatMap((row) => (row.willCallBy ? [row.willCallBy] : [])),
    );
    const availableInBranch = new Map<string, Set<string>>();
    for (const branchId of new Set(rows.map((row) => row.branchId))) {
      const practitioners = await this.users.listPractitioners({ branchId });
      availableInBranch.set(branchId, new Set(practitioners.map((item) => item.id)));
    }

    return rows.map((row) => {
      const patient = patients.get(row.patientId);
      if (!patient) throw new Error(`follow-up ${row.id} has no patient`);
      const statuses = row.planIds.flatMap((id) => {
        const status = plans.get(id);
        return status ? [status] : [];
      });
      return {
        id: row.id,
        branchId: row.branchId,
        patientId: row.patientId,
        patientName: patient.fullName,
        patientDisplayNumber: patient.displayNumber,
        sourceVisitId: row.sourceVisitId,
        sourceVisitNumber: row.sourceVisitNumber,
        recommendedBy: row.recommendedBy,
        recommendedByName: dentists.get(row.recommendedBy) ?? '',
        preferredDentistId: row.preferredDentistId,
        preferredDentistName: row.preferredDentistId
          ? (dentists.get(row.preferredDentistId) ?? null)
          : null,
        preferredDentistAvailable:
          row.preferredDentistId !== null &&
          (availableInBranch.get(row.branchId)?.has(row.preferredDentistId) ?? false),
        kind: row.kind,
        title: row.title,
        planIds: row.planIds,
        priority: row.priority,
        sessionNumber: row.sessionNumber,
        sessionTotal: row.sessionTotal,
        durationMin: row.durationMin,
        timing: row.timing,
        customDate: row.customDate,
        visitDate: row.visitDate,
        dueOn: row.dueOn,
        note: row.note,
        clinicalPrep: row.clinicalPrep,
        status: row.status,
        willCallAt: row.willCallAt?.toISOString() ?? null,
        willCallByName: row.willCallBy ? (taggers.get(row.willCallBy) ?? null) : null,
        declinedAt: row.declinedAt?.toISOString() ?? null,
        declinedReason: row.declinedReason,
        appointmentId: row.status === 'awaiting' ? null : (holders.get(row.id) ?? null),
        invalidReason: invalidReasonOf(statuses),
        createdAt: row.createdAt.toISOString(),
        ...deriveFollowUp(row, windowDays, today),
      };
    });
  }
}
