import {
  type AddWaitlistEntry,
  canWriteAppointment,
  canWriteWaitlistEntry,
  type RemoveWaitlistEntry,
  type UpdateWaitlistEntry,
  type WaitlistAttempt,
  type WaitlistEntry,
  type WaitlistSource,
  type WaitlistViewStatus,
  type WaitlistWishes,
  waitlistUntilDefault,
  waitlistUntilMax,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { PermissionDeniedError } from '../../../platform/cls/permission-denied.error';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { localClock, localDate } from '../../../platform/kernel/local-date';
import { AuditService } from '../../audit';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { deriveFollowUp } from '../domain/follow-up-dates';
import type { Interval } from '../domain/intervals';
import {
  AppointmentDentistNotInBranchError,
  WaitlistEntryExistsError,
  WaitlistEntryNotWaitingError,
  WaitlistFollowUpInvalidError,
  WaitlistInvalidUntilError,
} from '../domain/scheduling-errors';
import type { FitEntry } from '../domain/waitlist-fit';
import {
  AppointmentsRepository,
  type StoredAppointment,
} from '../persistence/appointments.repository';
import { FollowUpsRepository } from '../persistence/follow-ups.repository';
import { OpeningHoursRepository } from '../persistence/opening-hours.repository';
import {
  type StoredWaitlistEntry,
  type WaitlistEntryPatch,
  WaitlistRepository,
} from '../persistence/waitlist.repository';

const MERGE_REASON = 'Duplicate after merge';
const ARCHIVED_REASON = 'Patient archived';
const DECLINED_REASON = 'Follow-up declined';
const CANCEL_KEPT_REASON = 'Waits without the appointment';

/** The clinic's now, as the rules read it. */
export interface WaitlistNow {
  now: Date;
  today: string;
  timeZone: string;
}

const isWaitingAppointment = (row: StoredAppointment, now: Date) =>
  (row.status === 'booked' || row.status === 'confirmed') && row.startsAt > now;

const clock = (value: string | null) => (value === null ? null : value.slice(0, 5));

const wishesOf = (wishes: WaitlistWishes) => ({
  weekdays: [...wishes.weekdays].sort((a, b) => a - b),
  betweenFrom: wishes.betweenFrom,
  betweenTo: wishes.betweenTo,
  notBefore: wishes.notBefore,
  sameDay: wishes.sameDay,
  urgent: wishes.urgent,
  note: wishes.note,
});

const minutesOf = (row: StoredAppointment) =>
  Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);

/**
 * The waitlist's entries (feature 21, ADR-0103, ADR-0107): adding, editing, the call's outcomes,
 * removal, and the rules that keep the list true inside the transaction that sets them off. A rule
 * is audited as the system's. Expiry is derived when read; nothing here runs by itself.
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly waitlist: WaitlistRepository,
    private readonly appointments: AppointmentsRepository,
    private readonly followUps: FollowUpsRepository,
    private readonly settings: OpeningHoursRepository,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Reads ---

  /** The patient's live entries: the record's card, the panels' *On the waitlist* line. */
  forPatient(patientId: string): Promise<WaitlistEntry[]> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () => {
      const at = await this.nowOf();
      const rows = await this.waitlist.waitingForPatient(patientId);
      const entries = await this.present(rows, at);
      return entries.filter((entry) => entry.status === 'waiting');
    });
  }

  // --- Writes ---

  /** A patient waits with no appointment (A4); a second one answers 409 with the first. */
  add(input: AddWaitlistEntry): Promise<WaitlistEntry> {
    this.context.requirePermission('appointment:write');
    this.assertEntryColumn(input.dentistId);
    return this.tenantDb.run(async () => {
      const at = await this.nowOf();
      await this.patients.lockForBooking(input.patientId);
      await this.waitlist.lockPatient(input.patientId);
      const existing = await this.liveWithout(input.patientId, at);
      if (existing) throw new WaitlistEntryExistsError(existing.id);
      if (input.dentistId) await this.assertDentist(input.branchId, input.dentistId);
      if (input.followUpId) await this.assertFollowUp(input.followUpId, input.patientId, at);
      const until = this.untilOf(input.until, at);
      const row = await this.waitlist.insert({
        branchId: input.branchId,
        patientId: input.patientId,
        dentistId: input.dentistId,
        reason: input.reason,
        visitType: input.visitType,
        durationMin: input.durationMin,
        planIds: input.planIds,
        followUpId: input.followUpId ?? null,
        untilOn: until,
        ...wishesOf(input.wishes),
        createdBy: this.context.requireUserId(),
      });
      await this.record('waitlist_entry.add', row, {
        after: { ...this.snapshot(row), from: input.source },
      });
      return this.presentOne(row, at);
    });
  }

  update(id: string, input: UpdateWaitlistEntry): Promise<WaitlistEntry> {
    this.context.requirePermission('appointment:write');
    return this.tenantDb.run(async () => {
      const at = await this.nowOf();
      const before = await this.lockLive(id, at);
      await this.assertColumnOf(before);
      const patch: WaitlistEntryPatch = { ...wishesOf(input.wishes) };
      if (before.appointmentId === null) {
        if (input.dentistId !== undefined) {
          this.assertEntryColumn(input.dentistId);
          if (input.dentistId) await this.assertDentist(before.branchId, input.dentistId);
          patch.dentistId = input.dentistId;
        }
        if (input.reason !== undefined) patch.reason = input.reason;
        if (input.visitType !== undefined) patch.visitType = input.visitType;
        if (input.durationMin !== undefined) patch.durationMin = input.durationMin;
        if (input.until !== undefined) patch.untilOn = this.untilOf(input.until, at);
      }
      const after = await this.waitlist.update(id, patch);
      await this.record('waitlist_entry.update', after, {
        before: this.snapshot(before),
        after: this.snapshot(after),
      });
      return this.presentOne(after, at);
    });
  }

  /** *Remove from waitlist…* (B5): any waiting entry, expired or not. */
  remove(id: string, input: RemoveWaitlistEntry): Promise<WaitlistEntry> {
    this.context.requirePermission('appointment:write');
    return this.tenantDb.run(async () => {
      const at = await this.nowOf();
      const before = await this.waitlist.lock(id);
      if (before.status !== 'waiting') throw new WaitlistEntryNotWaitingError(id);
      await this.assertColumnOf(before);
      return this.presentOne(await this.close(before, 'removed', { reason: input.reason }), at);
    });
  }

  /** *No answer* and *Not this time* (B5): the last attempt only; calls are not logged. */
  attempt(id: string, input: WaitlistAttempt): Promise<WaitlistEntry> {
    this.context.requirePermission('appointment:write_all');
    return this.tenantDb.run(async () => {
      const at = await this.nowOf();
      await this.lockLive(id, at);
      const after = await this.waitlist.update(id, {
        attemptAt: at.now,
        attemptBy: this.context.requireUserId(),
        attemptOutcome: input.outcome,
      });
      await this.record(`waitlist_entry.${input.outcome}`, after, {
        after: { outcome: input.outcome },
      });
      return this.presentOne(after, at);
    });
  }

  // --- In the booking's and the fill's transactions ---

  /** One patient's waitlist writes run one at a time (one waiting entry of each kind). */
  lockPatient(patientId: string): Promise<void> {
    return this.waitlist.lockPatient(patientId);
  }

  /** *Wants an earlier time* on New or Edit appointment (A4): the appointment's entry. */
  async saveForAppointment(
    appointment: StoredAppointment,
    wishes: WaitlistWishes,
    source: WaitlistSource,
  ): Promise<void> {
    await this.waitlist.lockPatient(appointment.patientId);
    const [current] = await this.waitlist.waitingForAppointments([appointment.id]);
    if (current) {
      const after = await this.waitlist.update(current.id, wishesOf(wishes));
      await this.record('waitlist_entry.update', after, {
        before: this.snapshot(current),
        after: this.snapshot(after),
      });
      return;
    }
    const row = await this.waitlist.insert({
      branchId: appointment.branchId,
      patientId: appointment.patientId,
      appointmentId: appointment.id,
      dentistId: appointment.dentistId,
      reason: appointment.reason,
      visitType: appointment.visitType,
      durationMin: minutesOf(appointment),
      planIds: appointment.planIds,
      followUpId: appointment.followUpId,
      ...wishesOf(wishes),
      createdBy: this.context.requireUserId(),
    });
    await this.record('waitlist_entry.add', row, {
      after: { ...this.snapshot(row), from: source },
    });
  }

  /** Unticked in the Edit panel: the person removes it. */
  async removeForAppointment(appointmentId: string): Promise<void> {
    for (const row of await this.waitlist.waitingForAppointments([appointmentId])) {
      await this.close(row, 'removed', { reason: null });
    }
  }

  /** A move (reschedule, edit, fill): the entry follows its appointment (A5). */
  async followMove(
    from: StoredAppointment,
    to: StoredAppointment,
    exceptId?: string,
  ): Promise<void> {
    for (const row of await this.waitlist.waitingForAppointments([from.id])) {
      if (row.id === exceptId) continue;
      const after = await this.waitlist.update(row.id, {
        appointmentId: to.id,
        ...(row.dentistId === from.dentistId ? { dentistId: to.dentistId } : {}),
        durationMin: minutesOf(to),
      });
      await this.record('waitlist_entry.follow', after, {
        before: { appointmentId: from.id, startsAt: from.startsAt },
        after: { appointmentId: to.id, startsAt: to.startsAt },
        system: true,
      });
    }
  }

  /**
   * The cancel's *Add to waitlist* tick (A4, W5). Ticked, the patient waits with no appointment:
   * the appointment's entry turns into one, or a new one is made. Unticked, its entry is removed.
   */
  async onCancelled(appointment: StoredAppointment, keep: boolean, system = false): Promise<void> {
    await this.waitlist.lockPatient(appointment.patientId);
    const at = await this.nowOf();
    const [own] = await this.waitlist.waitingForAppointments([appointment.id]);
    if (!keep) {
      if (own) await this.close(own, 'removed', { reason: null, system });
      return;
    }
    const until = waitlistUntilDefault(at.today);
    const existing = await this.liveWithout(appointment.patientId, at);
    if (existing) {
      if (own) await this.close(own, 'removed', { reason: CANCEL_KEPT_REASON });
      return;
    }
    const fields = {
      appointmentId: null,
      dentistId: own?.dentistId ?? appointment.dentistId,
      reason: appointment.reason,
      visitType: appointment.visitType,
      durationMin: minutesOf(appointment),
      planIds: appointment.planIds,
      followUpId: appointment.followUpId,
      untilOn: until,
      cancelledAppointmentId: appointment.id,
    };
    if (own) {
      const after = await this.waitlist.update(own.id, { ...fields, cancelCreated: false });
      await this.record('waitlist_entry.keep', after, {
        before: this.snapshot(own),
        after: this.snapshot(after),
      });
      return;
    }
    const row = await this.waitlist.insert({
      branchId: appointment.branchId,
      patientId: appointment.patientId,
      ...fields,
      cancelCreated: true,
      createdBy: this.context.requireUserId(),
    });
    await this.record('waitlist_entry.add', row, {
      after: { ...this.snapshot(row), from: 'cancel' },
    });
  }

  /** Restore undoes the tick: a converted entry is the appointment's again, a new one is removed. */
  async onRestored(appointment: StoredAppointment): Promise<void> {
    for (const row of await this.waitlist.waitingFromCancel(appointment.id)) {
      if (row.cancelCreated) {
        await this.close(row, 'removed', { reason: null, system: true });
        continue;
      }
      const after = await this.waitlist.update(row.id, {
        appointmentId: appointment.id,
        untilOn: null,
        cancelledAppointmentId: null,
      });
      await this.record('waitlist_entry.follow', after, {
        after: { appointmentId: appointment.id, startsAt: appointment.startsAt },
        system: true,
      });
    }
  }

  /** A booking took the entry's follow-up: the entry is filled (A5). */
  async onFollowUpBooked(followUpId: string, appointmentId: string, exceptId?: string) {
    for (const row of await this.waitlist.waitingForFollowUps([followUpId])) {
      if (row.id === exceptId || row.appointmentId !== null) continue;
      await this.close(row, 'booked', { appointmentId, system: true });
    }
  }

  /** The patient asked to stop: the follow-up's entry goes too (A5). */
  async onFollowUpDeclined(followUpId: string): Promise<void> {
    for (const row of await this.waitlist.waitingForFollowUps([followUpId])) {
      await this.close(row, 'removed', { reason: DECLINED_REASON, system: true });
    }
  }

  async onPatientArchived(patientId: string): Promise<void> {
    for (const row of await this.waitlist.waitingForPatient(patientId)) {
      await this.close(row, 'removed', { reason: ARCHIVED_REASON, system: true });
    }
  }

  /** Entries move to the kept patient; of two without an appointment the older stays (A5). */
  async onPatientsMerged(droppedId: string, keptId: string): Promise<void> {
    await this.waitlist.repointPatient(droppedId, keptId);
    const at = await this.nowOf();
    const without = (await this.waitlist.waitingForPatient(keptId)).filter(
      (row) => row.appointmentId === null && this.isLiveWithout(row, at),
    );
    for (const row of without.slice(1)) {
      await this.close(row, 'removed', { reason: MERGE_REASON, system: true });
    }
  }

  /** A deactivated dentist's named entries become *Any dentist* (A5). */
  async onDentistDeactivated(profileId: string): Promise<void> {
    for (const row of await this.waitlist.waitingNamingDentist(profileId)) {
      const after = await this.waitlist.update(row.id, { dentistId: null });
      await this.record('waitlist_entry.any_dentist', after, {
        before: { dentistId: profileId },
        after: { dentistId: null },
        system: true,
      });
    }
  }

  /** The fill's last step (B4): the entry is booked, by the person filling it. */
  async markBooked(entry: StoredWaitlistEntry, appointment: StoredAppointment): Promise<void> {
    const { timeZone } = await this.nowOf();
    const [dentist] = await this.users.practitionersByProfileIds([appointment.dentistId]);
    await this.close(entry, 'booked', {
      appointmentId: appointment.id,
      opening: {
        startsAt: appointment.startsAt,
        date: localDate(appointment.startsAt, timeZone),
        time: localClock(appointment.startsAt, timeZone),
        dentistId: appointment.dentistId,
        dentistName: dentist?.displayName ?? '',
      },
    });
  }

  /** Locks a waiting, unexpired entry for a write. */
  async lockLive(id: string, at: WaitlistNow): Promise<StoredWaitlistEntry> {
    const row = await this.waitlist.lock(id);
    if (row.status !== 'waiting') throw new WaitlistEntryNotWaitingError(id);
    const appointment = row.appointmentId
      ? await this.appointments.byId(row.appointmentId)
      : undefined;
    if (this.statusOf(row, appointment, at) !== 'waiting') {
      throw new WaitlistEntryNotWaitingError(id);
    }
    return row;
  }

  /** The column for an entry: its appointment's, or the dentist it names (Access). */
  async assertColumnOf(row: StoredWaitlistEntry): Promise<void> {
    if (row.appointmentId) {
      const appointment = await this.appointments.byId(row.appointmentId);
      if (appointment && !canWriteAppointment(this.actor(), appointment)) {
        throw new PermissionDeniedError('appointment:write_all');
      }
      return;
    }
    this.assertEntryColumn(row.dentistId);
  }

  // --- Presenting ---

  async nowOf(): Promise<WaitlistNow> {
    const { timeZone } = await this.tenancy.currentTenant();
    const now = this.clock.now();
    return { now, today: localDate(now, timeZone), timeZone };
  }

  /** Waiting, booked, removed, or expired by its date or its appointment (ADR-0107). */
  statusOf(
    row: StoredWaitlistEntry,
    appointment: StoredAppointment | undefined,
    at: WaitlistNow,
  ): WaitlistViewStatus {
    if (row.status !== 'waiting') return row.status;
    if (row.appointmentId === null) return this.isLiveWithout(row, at) ? 'waiting' : 'expired';
    return appointment && isWaitingAppointment(appointment, at.now) ? 'waiting' : 'expired';
  }

  /** What the fit reads (B2): the appointment's duration, the patient's other appointments. */
  fitEntryOf(
    row: StoredWaitlistEntry,
    appointment: StoredAppointment | undefined,
    patientBusy: readonly StoredAppointment[],
  ): FitEntry {
    const busy: Interval[] = patientBusy
      .filter((other) => other.id !== row.appointmentId)
      .map((other) => ({ start: other.startsAt, end: other.endsAt }));
    return {
      id: row.id,
      branchId: row.branchId,
      dentistId: row.dentistId,
      durationMin: appointment ? minutesOf(appointment) : row.durationMin,
      weekdays: row.weekdays,
      betweenFrom: clock(row.betweenFrom),
      betweenTo: clock(row.betweenTo),
      notBefore: row.notBefore,
      sameDay: row.sameDay,
      until: row.appointmentId === null ? row.untilOn : null,
      appointmentStart: appointment ? appointment.startsAt : null,
      patientBusy: busy,
    };
  }

  /** Rows to the read model in batches; the number to call only with `patient:read`. */
  async present(rows: readonly StoredWaitlistEntry[], at: WaitlistNow): Promise<WaitlistEntry[]> {
    if (rows.length === 0) return [];
    const patientIds = [...new Set(rows.map((row) => row.patientId))];
    const appointmentIds = rows.flatMap((row) => (row.appointmentId ? [row.appointmentId] : []));
    const own = new Map(
      (await this.appointments.byIds([...new Set(appointmentIds)])).map((row) => [row.id, row]),
    );
    const others = await this.appointments.activeForPatients(patientIds, at.now);
    const followUps = new Map(
      (
        await this.followUps.byIds(rows.flatMap((row) => (row.followUpId ? [row.followUpId] : [])))
      ).map((row) => [row.id, row]),
    );
    const windowDays = await this.settings.windowDays();
    const dentistIds = [
      ...rows.flatMap((row) => (row.dentistId ? [row.dentistId] : [])),
      ...[...own.values(), ...others].map((row) => row.dentistId),
    ];
    const dentists = new Map(
      (await this.users.practitionersByProfileIds(dentistIds)).map((item) => [
        item.id,
        item.displayName,
      ]),
    );
    const patients = new Map(
      (await this.patients.refs(patientIds)).map((patient) => [patient.id, patient]),
    );
    const phones = new Map<string, string | null>();
    if (this.context.hasPermission('patient:read')) {
      for (const item of await this.patients.listItemsByIds(patientIds)) {
        phones.set(item.id, item.phone ?? item.primaryGuardian?.phone ?? null);
      }
    }
    const names = await this.users.namesByUserIds(
      rows.flatMap((row) => (row.attemptBy ? [row.createdBy, row.attemptBy] : [row.createdBy])),
    );
    const { timeZone } = at;
    const facts = (row: StoredAppointment) => ({
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      localDate: localDate(row.startsAt, timeZone),
      dentistId: row.dentistId,
      dentistName: dentists.get(row.dentistId) ?? '',
    });

    return rows.map((row) => {
      const patient = patients.get(row.patientId);
      if (!patient) throw new Error(`waitlist entry ${row.id} has no patient`);
      const appointment = row.appointmentId ? own.get(row.appointmentId) : undefined;
      const other = row.appointmentId
        ? undefined
        : others.find((item) => item.patientId === row.patientId);
      const followUp = row.followUpId ? followUps.get(row.followUpId) : undefined;
      const followUpLive =
        followUp !== undefined &&
        followUp.status === 'awaiting' &&
        !deriveFollowUp(followUp, windowDays, at.today).expired;
      const triedToday = row.attemptAt !== null && localDate(row.attemptAt, timeZone) === at.today;
      const status = this.statusOf(row, appointment, at);
      return {
        id: row.id,
        branchId: row.branchId,
        patient,
        callPhone: phones.get(row.patientId) ?? null,
        appointment: appointment ? facts(appointment) : null,
        otherAppointment: other ? (({ endsAt: _endsAt, ...rest }) => rest)(facts(other)) : null,
        dentistId: row.dentistId,
        dentistName: row.dentistId ? (dentists.get(row.dentistId) ?? null) : null,
        reason: appointment?.reason ?? row.reason,
        visitType: appointment ? appointment.visitType : row.visitType,
        durationMin: appointment ? minutesOf(appointment) : row.durationMin,
        planIds: appointment?.planIds ?? row.planIds,
        followUpId: appointment ? appointment.followUpId : followUpLive ? row.followUpId : null,
        wishes: {
          weekdays: row.weekdays,
          betweenFrom: clock(row.betweenFrom),
          betweenTo: clock(row.betweenTo),
          notBefore: row.notBefore,
          sameDay: row.sameDay,
        },
        urgent: row.urgent,
        note: row.note,
        until: appointment ? localDate(appointment.startsAt, timeZone) : (row.untilOn ?? at.today),
        status,
        lastAttempt:
          row.attemptAt && row.attemptOutcome
            ? {
                at: row.attemptAt.toISOString(),
                byName: (row.attemptBy ? names.get(row.attemptBy) : undefined) ?? '',
                outcome: row.attemptOutcome,
              }
            : null,
        triedToday,
        createdAt: row.createdAt.toISOString(),
        addedByName: names.get(row.createdBy) ?? '',
        closedAt: row.closedAt?.toISOString() ?? null,
        removeReason: row.removeReason,
        bookedAppointmentId: row.bookedAppointmentId,
        fits: null,
      };
    });
  }

  private async presentOne(row: StoredWaitlistEntry, at: WaitlistNow): Promise<WaitlistEntry> {
    const [entry] = await this.present([row], at);
    if (!entry) throw new Error('presenting a waitlist entry returned nothing');
    return entry;
  }

  // --- Helpers ---

  private isLiveWithout(row: StoredWaitlistEntry, at: WaitlistNow): boolean {
    return row.untilOn !== null && row.untilOn >= at.today;
  }

  private async liveWithout(
    patientId: string,
    at: WaitlistNow,
  ): Promise<StoredWaitlistEntry | undefined> {
    return (await this.waitlist.waitingForPatient(patientId)).find(
      (row) => row.appointmentId === null && this.isLiveWithout(row, at),
    );
  }

  private untilOf(until: string | undefined, at: WaitlistNow): string {
    const value = until ?? waitlistUntilDefault(at.today);
    if (value < at.today || value > waitlistUntilMax(at.today))
      throw new WaitlistInvalidUntilError();
    return value;
  }

  private async assertDentist(branchId: string, dentistId: string): Promise<void> {
    const practitioners = await this.users.listPractitioners({ branchId });
    if (!practitioners.some((item) => item.id === dentistId)) {
      throw new AppointmentDentistNotInBranchError(dentistId);
    }
  }

  private async assertFollowUp(id: string, patientId: string, at: WaitlistNow): Promise<void> {
    const [followUp] = await this.followUps.byIds([id]);
    const windowDays = await this.settings.windowDays();
    if (
      followUp?.patientId !== patientId ||
      followUp.status !== 'awaiting' ||
      deriveFollowUp(followUp, windowDays, at.today).expired
    ) {
      throw new WaitlistFollowUpInvalidError(id);
    }
  }

  private actor() {
    return {
      permissions: this.context.grantedPermissions(),
      profileId: this.context.staffProfileId,
    };
  }

  /** An entry without an appointment names its dentist's column; *Any dentist* is everyone's. */
  private assertEntryColumn(dentistId: string | null): void {
    if (!canWriteWaitlistEntry(this.actor(), { dentistId })) {
      throw new PermissionDeniedError('appointment:write_all');
    }
  }

  private async close(
    row: StoredWaitlistEntry,
    status: 'booked' | 'removed',
    options: {
      reason?: string | null;
      appointmentId?: string;
      opening?: Record<string, unknown>;
      system?: boolean;
    },
  ): Promise<StoredWaitlistEntry> {
    const after = await this.waitlist.update(row.id, {
      status,
      closedBy: this.context.requireUserId(),
      closedAt: this.clock.now(),
      ...(status === 'removed' ? { removeReason: options.reason ?? null } : {}),
      ...(options.appointmentId ? { bookedAppointmentId: options.appointmentId } : {}),
    });
    await this.record(
      status === 'booked' ? 'waitlist_entry.book' : 'waitlist_entry.remove',
      after,
      {
        before: { status: row.status },
        after: {
          status,
          reason: after.reason,
          ...(options.appointmentId ? { appointmentId: options.appointmentId } : {}),
          ...(options.opening ? options.opening : {}),
        },
        reason: options.reason ?? undefined,
        system: options.system ?? false,
      },
    );
    return after;
  }

  private snapshot(row: StoredWaitlistEntry) {
    return {
      reason: row.reason,
      appointmentId: row.appointmentId,
      dentistId: row.dentistId,
      durationMin: row.durationMin,
      untilOn: row.untilOn,
      weekdays: row.weekdays,
      betweenFrom: clock(row.betweenFrom),
      betweenTo: clock(row.betweenTo),
      notBefore: row.notBefore,
      sameDay: row.sameDay,
      urgent: row.urgent,
    };
  }

  private record(
    action: string,
    row: StoredWaitlistEntry,
    change: { before?: unknown; after?: unknown; reason?: string | undefined; system?: boolean },
  ): Promise<void> {
    const { system, ...rest } = change;
    return this.audit.record({
      action,
      resourceType: 'waitlist_entry',
      resourceId: row.id,
      patientId: row.patientId,
      ...rest,
      ...(system ? { actorKind: 'system' as const } : {}),
    });
  }
}
