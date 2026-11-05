import {
  type Appointment,
  type AppointmentCheck,
  type AppointmentCheckResult,
  type AppointmentConflict,
  type AppointmentRangeQuery,
  type BookAppointment,
  canCancel,
  canCheckIn,
  canConfirm,
  canMarkNoShow,
  canMove,
  canRestore,
  canWriteAppointment,
  isActiveAppointment,
  type CancelAppointment,
  type ChangeAppointmentRoom,
  type CheckInAppointment,
  type ConflictKind,
  type EditAppointment,
  type NextAppointmentPayload,
  type OpeningDay,
  type RescheduleAppointment,
  type ResizeAppointment,
  type RestoreAppointment,
  type ScheduleResources,
  SLOT_SEARCH_MAX_DAYS,
  type SlotDay,
  type SlotQuery,
  type TodayBoard,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { PermissionDeniedError } from '../../../platform/cls/permission-denied.error';
import { RequestContext } from '../../../platform/cls/request-context';
import { exclusionViolationOf } from '../../../platform/db/unique-violation';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { newId } from '../../../platform/kernel/id';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { VisitFactsService } from '../../clinical';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { assertTransition } from '../domain/appointment-lifecycle';
import { type AutoRoom, chooseRoom, type RoomRef } from '../domain/auto-room';
import {
  type BookedSpan,
  evaluateConflicts,
  hardConflicts,
  softConflicts,
} from '../domain/conflicts';
import { datesBetween, type Interval, overlaps, plusMinutes } from '../domain/intervals';
import {
  AppointmentActionUnavailableError,
  AppointmentConflictError,
  AppointmentDentistNotInBranchError,
  AppointmentIdempotencyMismatchError,
  AppointmentInPastError,
  AppointmentInvalidRangeError,
  AppointmentNotForPatientError,
  AppointmentNotFoundError,
  AppointmentRoomNotInBranchError,
  MergeAppointmentsInProgressError,
  PatientHasUpcomingAppointmentsError,
  StaffHasOpenAppointmentsError,
} from '../domain/scheduling-errors';
import { daySlots } from '../domain/slots';
import {
  APPOINTMENT_BOOKED,
  APPOINTMENT_CANCELLED,
  APPOINTMENT_CHECK_IN_UNDONE,
  APPOINTMENT_CHECKED_IN,
  APPOINTMENT_COMPLETED,
  APPOINTMENT_CONFIRMED,
  APPOINTMENT_EDITED,
  APPOINTMENT_MARKED_NO_SHOW,
  APPOINTMENT_RESCHEDULED,
  APPOINTMENT_RESIZED,
  APPOINTMENT_RESTORED,
  APPOINTMENT_ROOM_CHANGED,
  APPOINTMENT_STARTED,
  type AppointmentBooked,
  type AppointmentCancelled,
  type AppointmentCheckedIn,
  type AppointmentCheckInUndone,
  type AppointmentCompleted,
  type AppointmentConfirmed,
  type AppointmentEdited,
  type AppointmentEditedField,
  type AppointmentMarkedNoShow,
  type AppointmentRescheduled,
  type AppointmentResized,
  type AppointmentRestored,
  type AppointmentRoomChanged,
  type AppointmentStarted,
} from '../events/scheduling-events';
import {
  AppointmentsRepository,
  type StoredAppointment,
} from '../persistence/appointments.repository';
import { OpeningHoursRepository } from '../persistence/opening-hours.repository';
import { AppointmentPresenter } from './appointment-presenter';
import { type CompletionFacts, FollowUpsService } from './follow-ups.service';

const USUAL_ROOM_DAYS = 30;
const MERGE_CANCEL_REASON = 'Duplicate after merge';

interface Placement {
  pick: AutoRoom;
  conflicts: AppointmentConflict[];
  roomAuto: boolean;
}

interface PlacementRequest {
  branchId: string;
  dentist: { id: string; name: string };
  patientId: string | null;
  span: Interval;
  roomChoice: string;
  ignoreAppointmentId?: string | undefined;
}

/** What a move writes on the new row: from `reschedule`, the old row's; from `edit`, the panel's. */
interface MoveValues {
  dentistId: string;
  span: Interval;
  placement: Placement;
  reason: string;
  visitType: StoredAppointment['visitType'];
  confirmed: boolean;
  overridden: ConflictKind[];
  idempotency: { key: string; hash: string } | null;
}

const isWaiting = (row: StoredAppointment) => row.status === 'booked' || row.status === 'confirmed';

const idempotent = (key: string | undefined, request: unknown) =>
  key === undefined ? null : { key, hash: requestHash(request) };

/**
 * Booking and the appointment's life (ADR-0066, ADR-0067). Every write re-checks `appointment:write`
 * and the column (`canWriteAppointment`), audits and publishes in its transaction. A room or patient
 * race is refused by the exclusion constraints and answers like any other conflict.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly appointments: AppointmentsRepository,
    private readonly hours: OpeningHoursRepository,
    private readonly presenter: AppointmentPresenter,
    private readonly followUps: FollowUpsService,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    private readonly visitFacts: VisitFactsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Reads ---

  /** The calendar: a dentist who left has no column (G16), so their rows are left out. */
  range(query: AppointmentRangeQuery): Promise<Appointment[]> {
    this.context.requirePermission('appointment:read');
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to <= from || to.getTime() - from.getTime() > SLOT_SEARCH_MAX_DAYS * 86_400_000) {
      throw new AppointmentInvalidRangeError();
    }
    return this.tenantDb.run(async () => {
      const rows = await this.appointments.range({
        branchId: query.branchId,
        from,
        to,
        dentistIds: query.dentistIds,
        roomId: query.roomId,
      });
      const active = new Set((await this.users.listPractitioners()).map((item) => item.id));
      return this.presenter.presentAll(rows.filter((row) => active.has(row.dentistId)));
    });
  }

  get(id: string): Promise<Appointment> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () => {
      const row = await this.appointments.byId(id);
      if (!row) throw new AppointmentNotFoundError(id);
      return this.presenter.present(row);
    });
  }

  forPatient(patientId: string): Promise<Appointment[]> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () =>
      this.presenter.presentAll(await this.appointments.forPatient(patientId)),
    );
  }

  resources(branchId: string): Promise<ScheduleResources> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () => {
      const everyone = await this.users.listPractitioners();
      const inBranch = new Set(
        (await this.users.listPractitioners({ branchId })).map((item) => item.id),
      );
      return {
        dentists: everyone.flatMap((item, order) =>
          inBranch.has(item.id) ? [{ id: item.id, name: item.displayName, order }] : [],
        ),
        rooms: (await this.activeRooms(branchId)).map(({ id, name }) => ({ id, name })),
      };
    });
  }

  todayBoard(branchId: string): Promise<TodayBoard> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () => {
      const { timeZone } = await this.tenancy.currentTenant();
      const now = this.clock.now();
      const date = localDate(now, timeZone);
      const [tomorrow = date] = datesBetween(date, date).map((day) =>
        new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
      );
      const rows = await this.appointments.range({
        branchId,
        from: zonedInstant(date, '00:00', timeZone),
        to: zonedInstant(tomorrow, '00:00', timeZone),
      });
      const appointments = (await this.presenter.presentAll(rows)).filter(
        (item) => item.localDate === date,
      );
      return {
        date,
        appointments,
        unresolvedCount: appointments.filter((item) => item.unresolved).length,
        unconfirmedCount: appointments.filter((item) => item.status === 'booked').length,
      };
    });
  }

  /** The dry run behind the panel, drag and move mode: what a save would say. */
  check(input: AppointmentCheck): Promise<AppointmentCheckResult> {
    this.context.requirePermission('appointment:read');
    return this.tenantDb.run(async () => {
      const start = new Date(input.startsAt);
      const span = { start, end: plusMinutes(start, input.durationMin) };
      const practitioners = await this.users.listPractitioners({ branchId: input.branchId });
      const dentist = practitioners.find((item) => item.id === input.dentistId);
      if (!dentist) throw new AppointmentDentistNotInBranchError(input.dentistId);
      const { pick, conflicts } = await this.place({
        branchId: input.branchId,
        dentist: { id: dentist.id, name: dentist.displayName },
        patientId: input.patientId ?? null,
        span,
        roomChoice: input.roomId,
        ignoreAppointmentId: input.ignoreAppointmentId,
      });
      return {
        conflicts,
        room: {
          roomId: pick.room?.id ?? null,
          roomName: pick.room?.name ?? null,
          usualRoomId: pick.usualRoom?.id ?? null,
          usualRoomName: pick.usualRoom?.name ?? null,
          isUsual: pick.isUsual,
        },
      };
    });
  }

  /** A10: the free starts of each day in the range. */
  slots(query: SlotQuery): Promise<SlotDay[]> {
    this.context.requirePermission('appointment:read');
    const dates = query.from > query.to ? [] : datesBetween(query.from, query.to);
    if (dates.length === 0 || dates.length > SLOT_SEARCH_MAX_DAYS) {
      throw new AppointmentInvalidRangeError();
    }
    return this.tenantDb.run(async () => {
      const { timeZone } = await this.tenancy.currentTenant();
      const hours = await this.hours.forBranch(query.branchId);
      const rooms = await this.activeRooms(query.branchId);
      const now = this.clock.now();
      const usualRoomId = await this.usualRoomId(query.dentistId, query.branchId);
      const moved = query.ignoreAppointmentId
        ? await this.appointments.byId(query.ignoreAppointmentId)
        : undefined;
      const fixedRoomId = moved && !moved.roomAuto ? moved.roomId : null;
      const window = {
        start: zonedInstant(dates[0] ?? query.from, '00:00', timeZone),
        end: plusMinutes(
          zonedInstant(dates.at(-1) ?? query.to, '23:59', timeZone),
          1 + query.durationMin,
        ),
      };
      const others = (await this.appointments.activeOverlapping(window)).filter(
        (row) => row.id !== query.ignoreAppointmentId,
      );
      const spans = (matches: (row: StoredAppointment) => boolean): Interval[] =>
        others.filter(matches).map((row) => ({ start: row.startsAt, end: row.endsAt }));
      const dentistBusy = spans((row) => row.dentistId === query.dentistId);
      const patientBusy = spans((row) => row.patientId === query.patientId);
      const fixedRoomBusy = fixedRoomId ? spans((row) => row.roomId === fixedRoomId) : [];
      const hard = [patientBusy, fixedRoomBusy];

      return dates.map((date) => ({
        date,
        slots: daySlots({
          date,
          hours,
          timeZone,
          durationMin: query.durationMin,
          stepMin: query.stepMin,
          now,
          busy: query.includeWarnings ? hard : [dentistBusy, ...hard],
          warnedBusy: dentistBusy,
          includeWarnings: query.includeWarnings ?? false,
        }).map((slot) => {
          const free = (roomId: string) =>
            !others.some(
              (row) =>
                row.roomId === roomId &&
                overlaps(slot, {
                  start: row.startsAt,
                  end: row.endsAt,
                }),
            );
          const fixed = fixedRoomId ? rooms.find((room) => room.id === fixedRoomId) : undefined;
          const pick = fixed
            ? {
                room: fixed,
                usualRoom: rooms.find((room) => room.id === usualRoomId) ?? null,
                isUsual: fixed.id === usualRoomId,
              }
            : chooseRoom(rooms, usualRoomId, free);
          return {
            startsAt: slot.start.toISOString(),
            endsAt: slot.end.toISOString(),
            warnings: slot.warnings,
            roomId: pick.room?.id ?? null,
            roomName: pick.room?.name ?? null,
            usualRoomId: pick.usualRoom?.id ?? null,
            usualRoomName: pick.usualRoom?.name ?? null,
            isUsual: pick.isUsual,
          };
        }),
      }));
    });
  }

  // --- Writes ---

  book(input: BookAppointment, key?: string): Promise<Appointment> {
    this.context.requirePermission('appointment:write');
    this.assertColumn(input.dentistId);
    const idempotency = idempotent(key, input);
    return this.translatingRaces(input.roomId === 'auto', () =>
      this.tenantDb.run(async () => {
        const first = await this.replay(idempotency);
        if (first) return first;
        const start = new Date(input.startsAt);
        if (start < this.clock.now()) throw new AppointmentInPastError();
        const dentist = await this.dentistOf(input.branchId, input.dentistId);
        await this.patients.lockForBooking(input.patientId);
        if (input.sourceVisitId) await this.assertSourceVisit(input.sourceVisitId, input.patientId);
        if (input.followUpId)
          await this.followUps.lockForBooking(input.followUpId, input.patientId);
        const span = { start, end: plusMinutes(start, input.durationMin) };
        const placement = await this.place({
          branchId: input.branchId,
          dentist,
          patientId: input.patientId,
          span,
          roomChoice: input.roomId,
        });
        const overridden = this.assertAllowed(placement.conflicts, input.override);
        const userId = this.context.requireUserId();
        const id = newId();
        const row = await this.appointments.insert({
          id,
          branchId: input.branchId,
          patientId: input.patientId,
          dentistId: input.dentistId,
          roomId: placement.pick.room?.id ?? null,
          roomAuto: placement.roomAuto,
          startsAt: span.start,
          endsAt: span.end,
          status: input.confirmed ? 'confirmed' : 'booked',
          reason: input.reason,
          visitType: input.visitType,
          planIds: input.planIds,
          followUpId: input.followUpId ?? null,
          sourceVisitId: input.sourceVisitId ?? null,
          lineageId: id,
          overridden,
          bookedBy: userId,
          confirmedBy: input.confirmed ? userId : null,
          confirmedAt: input.confirmed ? this.clock.now() : null,
          idempotencyKey: idempotency?.key ?? null,
          idempotencyHash: idempotency?.hash ?? null,
        });
        if (input.followUpId) await this.followUps.markBooked(input.followUpId, row.id);
        await this.record('appointment.book', row, { after: this.snapshot(row) });
        const event: AppointmentBooked = this.events.create(APPOINTMENT_BOOKED, {
          appointmentId: row.id,
          patientId: row.patientId,
          dentistId: row.dentistId,
          overridden,
        });
        await this.events.publish(event);
        return this.presenter.present(row);
      }),
    );
  }

  /** A new row in the same lineage; the old one stays as `rescheduled` (CLAUDE.md §8). */
  reschedule(id: string, input: RescheduleAppointment, key?: string): Promise<Appointment> {
    this.context.requirePermission('appointment:write');
    const idempotency = idempotent(key, { id, ...input });
    return this.translatingRaces(true, () =>
      this.tenantDb.run(async () => {
        const first = await this.replay(idempotency);
        if (first) return first;
        // Patient first, the order of a merge: an archive or a merge then sees the new time.
        const current = await this.appointments.byId(id);
        if (!current) throw new AppointmentNotFoundError(id);
        await this.patients.lockForBooking(current.patientId);
        const before = await this.appointments.lock(id);
        this.assertColumn(before.dentistId);
        const dentistId = input.dentistId ?? before.dentistId;
        this.assertColumn(dentistId);
        const today = await this.today();
        if (!canMove(this.momentOf(before, today.timeZone), today.date)) {
          throw new AppointmentActionUnavailableError('reschedule');
        }
        assertTransition(before.status, 'rescheduled');
        const start = new Date(input.startsAt);
        if (start < this.clock.now()) throw new AppointmentInPastError();
        const dentist = await this.dentistOf(before.branchId, dentistId);
        const span = {
          start,
          end: new Date(start.getTime() + before.endsAt.getTime() - before.startsAt.getTime()),
        };
        const placement = await this.place({
          branchId: before.branchId,
          dentist,
          patientId: before.patientId,
          span,
          roomChoice: input.roomId ?? (before.roomAuto ? 'auto' : (before.roomId ?? 'auto')),
          ignoreAppointmentId: before.id,
        });
        const overridden = this.assertAllowed(placement.conflicts, input.override);
        const row = await this.moveRow(before, {
          dentistId,
          span,
          placement,
          reason: before.reason,
          visitType: before.visitType,
          confirmed: false,
          overridden,
          idempotency,
        });
        return this.presenter.present(row);
      }),
    );
  }

  /**
   * The Edit appointment panel (ADR-0075). The same start and dentist change the row in place; another
   * start or dentist is a move, a new row in the lineage, as `reschedule`. Only the move creates a row,
   * so only the move keeps the key: an edit in place repeated sets the same values again.
   */
  edit(id: string, input: EditAppointment, key?: string): Promise<Appointment> {
    this.context.requirePermission('appointment:write');
    const idempotency = idempotent(key, { id, ...input });
    return this.translatingRaces(input.roomId === 'auto', () =>
      this.tenantDb.run(async () => {
        const first = await this.replay(idempotency);
        if (first) return first;
        const current = await this.appointments.byId(id);
        if (!current) throw new AppointmentNotFoundError(id);
        await this.patients.lockForBooking(current.patientId);
        const before = await this.appointments.lock(id);
        this.assertColumn(before.dentistId);
        this.assertColumn(input.dentistId);
        const today = await this.today();
        if (!canMove(this.momentOf(before, today.timeZone), today.date)) {
          throw new AppointmentActionUnavailableError('edit');
        }
        const start = new Date(input.startsAt);
        const moved =
          start.getTime() !== before.startsAt.getTime() || input.dentistId !== before.dentistId;
        if (moved && start < this.clock.now()) throw new AppointmentInPastError();
        const dentist = await this.dentistOf(before.branchId, input.dentistId);
        const span = { start, end: plusMinutes(start, input.durationMin) };
        const request = {
          branchId: before.branchId,
          dentist,
          patientId: before.patientId,
          span,
          roomChoice: input.roomId,
          ignoreAppointmentId: before.id,
        };
        // Left on Auto in place, it keeps the room it was given while that room is active and free.
        const keepsRoom =
          !moved &&
          input.roomId === 'auto' &&
          before.roomAuto &&
          before.roomId !== null &&
          (await this.activeRooms(before.branchId)).some((room) => room.id === before.roomId);
        let placement = await this.place(
          keepsRoom ? { ...request, roomChoice: before.roomId ?? 'auto' } : request,
        );
        if (keepsRoom) {
          placement = placement.conflicts.some((conflict) => conflict.kind === 'room')
            ? await this.place(request)
            : { ...placement, roomAuto: true };
        }
        // The same time: its warnings were passed when it was booked, only a room clash is new.
        const sameSpan = !moved && span.end.getTime() === before.endsAt.getTime();
        const overridden = sameSpan
          ? this.assertAllowed(hardConflicts(placement.conflicts), false)
          : this.assertAllowed(placement.conflicts, input.override);
        const values = { ...input, span, placement, overridden };
        const row = moved
          ? await this.moveRow(before, { ...values, idempotency })
          : await this.editInPlace(before, values);
        return this.presenter.present(row);
      }),
    );
  }

  /** The same row's end; the status stays (D3). */
  resize(id: string, input: ResizeAppointment): Promise<Appointment> {
    this.context.requirePermission('appointment:write');
    return this.translatingRaces(false, () =>
      this.tenantDb.run(async () => {
        const before = await this.appointments.lock(id);
        this.assertColumn(before.dentistId);
        const today = await this.today();
        if (!canMove(this.momentOf(before, today.timeZone), today.date)) {
          throw new AppointmentActionUnavailableError('resize');
        }
        const dentist = await this.dentistOf(before.branchId, before.dentistId);
        const span = {
          start: before.startsAt,
          end: plusMinutes(before.startsAt, input.durationMin),
        };
        const placement = await this.place({
          branchId: before.branchId,
          dentist,
          patientId: before.patientId,
          span,
          roomChoice: before.roomId ?? 'none',
          ignoreAppointmentId: before.id,
        });
        const overridden = this.assertAllowed(placement.conflicts, input.override);
        const row = await this.appointments.update(id, {
          endsAt: span.end,
          overridden: [...new Set([...before.overridden, ...overridden])],
        });
        await this.record('appointment.resize', row, {
          before: this.snapshot(before),
          after: this.snapshot(row),
        });
        const event: AppointmentResized = this.events.create(APPOINTMENT_RESIZED, {
          appointmentId: row.id,
          patientId: row.patientId,
          overridden,
        });
        await this.events.publish(event);
        return this.presenter.present(row);
      }),
    );
  }

  confirm(id: string): Promise<Appointment> {
    return this.act(id, async (before) => {
      const today = await this.today();
      if (!canConfirm(this.momentOf(before, today.timeZone), today.date)) {
        throw new AppointmentActionUnavailableError('confirm');
      }
      assertTransition(before.status, 'confirmed');
      const row = await this.appointments.update(id, {
        status: 'confirmed',
        confirmedBy: this.context.requireUserId(),
        confirmedAt: this.clock.now(),
      });
      await this.record('appointment.confirm', row, {
        before: { status: before.status },
        after: { status: row.status },
      });
      const event: AppointmentConfirmed = this.events.create(APPOINTMENT_CONFIRMED, {
        appointmentId: id,
        patientId: row.patientId,
      });
      await this.events.publish(event);
      return row;
    });
  }

  checkIn(id: string, input: CheckInAppointment): Promise<Appointment> {
    return this.translatingRaces(false, () =>
      this.act(id, async (before) => {
        const today = await this.today();
        if (!canCheckIn(this.momentOf(before, today.timeZone), today.date)) {
          throw new AppointmentActionUnavailableError('check_in');
        }
        assertTransition(before.status, 'checked_in');
        if (input.roomId) await this.assertRoom(before.branchId, input.roomId);
        const row = await this.appointments.update(id, {
          status: 'checked_in',
          checkedInBy: this.context.requireUserId(),
          checkedInAt: this.clock.now(),
          ...(input.roomId ? { roomId: input.roomId, roomAuto: false } : {}),
        });
        await this.record('appointment.check_in', row, {
          before: { status: before.status, roomId: before.roomId },
          after: { status: row.status, roomId: row.roomId },
        });
        const event: AppointmentCheckedIn = this.events.create(APPOINTMENT_CHECKED_IN, {
          appointmentId: id,
          patientId: row.patientId,
        });
        await this.events.publish(event);
        return row;
      }),
    );
  }

  /** G11: a mistaken check-in would otherwise be stuck, `checked_in` cannot be cancelled. */
  undoCheckIn(id: string): Promise<Appointment> {
    return this.act(id, async (before) => {
      if (before.status !== 'checked_in') {
        throw new AppointmentActionUnavailableError('undo_check_in');
      }
      const row = await this.appointments.update(id, {
        status: 'confirmed',
        checkedInBy: null,
        checkedInAt: null,
      });
      await this.record('appointment.undo_check_in', row, {
        before: { status: before.status },
        after: { status: row.status },
      });
      const event: AppointmentCheckInUndone = this.events.create(APPOINTMENT_CHECK_IN_UNDONE, {
        appointmentId: id,
        patientId: row.patientId,
      });
      await this.events.publish(event);
      return row;
    });
  }

  /** G12: `roomId: null` leaves it to check-in. */
  changeRoom(id: string, input: ChangeAppointmentRoom): Promise<Appointment> {
    return this.translatingRaces(false, () =>
      this.act(id, async (before) => {
        if (before.status === 'in_room' || !this.isOpen(before)) {
          throw new AppointmentActionUnavailableError('room');
        }
        if (input.roomId) await this.assertRoom(before.branchId, input.roomId);
        const row = await this.appointments.update(id, { roomId: input.roomId, roomAuto: false });
        await this.record('appointment.room', row, {
          before: { roomId: before.roomId },
          after: { roomId: row.roomId },
        });
        const event: AppointmentRoomChanged = this.events.create(APPOINTMENT_ROOM_CHANGED, {
          appointmentId: id,
          patientId: row.patientId,
          roomId: row.roomId,
        });
        await this.events.publish(event);
        return row;
      }),
    );
  }

  cancel(id: string, input: CancelAppointment): Promise<Appointment> {
    return this.act(id, async (before) => {
      if (!canCancel(this.momentOf(before, 'UTC'))) {
        throw new AppointmentActionUnavailableError('cancel');
      }
      return this.cancelRow(before, input.reason);
    });
  }

  /**
   * ADR-0075: a cancel undone on the same row, while its start is ahead. It is placed as a move to the
   * same time would be: an Auto room is chosen again, a room picked by hand must still be free. Its
   * follow-up comes back when it is still on the list; otherwise the link is dropped.
   */
  restore(id: string, input: RestoreAppointment): Promise<Appointment> {
    this.context.requirePermission('appointment:write');
    // A race on the room runs it again: Auto chooses anew, a room picked by hand then refuses.
    return this.translatingRaces(true, () =>
      this.tenantDb.run(async () => {
        const current = await this.appointments.byId(id);
        if (!current) throw new AppointmentNotFoundError(id);
        await this.patients.lockForBooking(current.patientId);
        const before = await this.appointments.lock(id);
        this.assertColumn(before.dentistId);
        if (!canRestore(this.momentOf(before, 'UTC'), this.clock.now())) {
          throw new AppointmentActionUnavailableError('restore');
        }
        const status = before.confirmedAt ? 'confirmed' : 'booked';
        assertTransition(before.status, status);
        const placement = await this.place({
          branchId: before.branchId,
          dentist: await this.dentistOf(before.branchId, before.dentistId),
          patientId: before.patientId,
          span: { start: before.startsAt, end: before.endsAt },
          roomChoice: before.roomAuto ? 'auto' : (before.roomId ?? 'none'),
          ignoreAppointmentId: before.id,
        });
        const overridden = this.assertAllowed(placement.conflicts, input.override);
        const keepsFollowUp = before.followUpId
          ? await this.followUps.relink(before.followUpId, before.id)
          : false;
        const row = await this.appointments.update(id, {
          status,
          roomId: placement.pick.room?.id ?? null,
          cancelReason: null,
          closedBy: null,
          closedAt: null,
          overridden: [...new Set([...before.overridden, ...overridden])],
          ...(before.followUpId && !keepsFollowUp ? { followUpId: null } : {}),
        });
        await this.record('appointment.restore', row, {
          before: { status: before.status, cancelReason: before.cancelReason },
          after: { status: row.status, roomId: row.roomId },
        });
        const event: AppointmentRestored = this.events.create(APPOINTMENT_RESTORED, {
          appointmentId: id,
          patientId: row.patientId,
          overridden,
        });
        await this.events.publish(event);
        return this.presenter.present(row);
      }),
    );
  }

  markNoShow(id: string): Promise<Appointment> {
    return this.act(id, async (before) => {
      if (!canMarkNoShow(this.momentOf(before, 'UTC'), this.clock.now())) {
        throw new AppointmentActionUnavailableError('no_show');
      }
      assertTransition(before.status, 'no_show');
      const row = await this.appointments.update(id, {
        status: 'no_show',
        closedBy: this.context.requireUserId(),
        closedAt: this.clock.now(),
      });
      await this.record('appointment.no_show', row, {
        before: { status: before.status },
        after: { status: row.status },
      });
      const event: AppointmentMarkedNoShow = this.events.create(APPOINTMENT_MARKED_NO_SHOW, {
        appointmentId: id,
        patientId: row.patientId,
      });
      await this.events.publish(event);
      if (row.followUpId) await this.followUps.reopen(row.followUpId);
      return row;
    });
  }

  // --- Reactions, in the publisher's transaction. A colleague may start the visit (G10). ---

  /** `VisitStarted` and `VisitLinkedToAppointment`. From waiting, it checks the patient in too. */
  async onVisitStarted(appointmentId: string, patientId: string, visitId: string): Promise<void> {
    const before = await this.appointments.lock(appointmentId);
    if (before.patientId !== patientId) throw new AppointmentNotForPatientError(appointmentId);
    assertTransition(before.status, 'in_room');
    const row = await this.appointments.update(appointmentId, {
      status: 'in_room',
      ...(before.checkedInAt
        ? {}
        : { checkedInBy: this.context.requireUserId(), checkedInAt: this.clock.now() }),
    });
    await this.record(
      'appointment.start',
      row,
      { before: { status: before.status }, after: { status: row.status } },
      visitId,
    );
    const event: AppointmentStarted = this.events.create(APPOINTMENT_STARTED, {
      appointmentId,
      patientId,
      visitId,
    });
    await this.events.publish(event);
  }

  /** `VisitDiscarded`: the patient is still here, waiting. */
  async onVisitDiscarded(appointmentId: string): Promise<void> {
    const before = await this.appointments.lock(appointmentId);
    if (before.status !== 'in_room') return;
    const row = await this.appointments.update(appointmentId, { status: 'checked_in' });
    await this.record('appointment.undo_start', row, {
      before: { status: before.status },
      after: { status: row.status },
    });
  }

  /**
   * `VisitCompleted` (A15): the appointment and its follow-up finish, and the visit's own follow-up
   * is created in the same transaction. A booked appointment that is not this visit's vetoes the
   * completion; one cancelled since leaves the follow-up awaiting.
   */
  async onVisitCompleted(
    appointmentId: string | null,
    nextAppointment: NextAppointmentPayload | null,
    facts: CompletionFacts,
  ): Promise<void> {
    if (appointmentId) await this.completeAppointment(appointmentId, facts);
    if (!nextAppointment) return;
    const booked = nextAppointment.bookedAppointmentId
      ? await this.appointments.lock(nextAppointment.bookedAppointmentId)
      : null;
    if (booked && booked.sourceVisitId !== facts.visitId) {
      throw new AppointmentNotForPatientError(booked.id);
    }
    const holding = booked ? await this.currentOf(booked) : null;
    const created = await this.followUps.recommend(nextAppointment, facts, holding?.id ?? null);
    if (holding) await this.appointments.update(holding.id, { followUpId: created.id });
  }

  private async completeAppointment(id: string, facts: CompletionFacts): Promise<void> {
    const before = await this.appointments.lock(id);
    if (before.status !== 'in_room') return;
    const row = await this.appointments.update(id, {
      status: 'completed',
      closedBy: this.context.requireUserId(),
      closedAt: this.clock.now(),
    });
    await this.record(
      'appointment.complete',
      row,
      { before: { status: before.status }, after: { status: row.status } },
      facts.visitId,
    );
    const event: AppointmentCompleted = this.events.create(APPOINTMENT_COMPLETED, {
      appointmentId: id,
      patientId: row.patientId,
      visitId: facts.visitId,
    });
    await this.events.publish(event);
    if (row.followUpId) await this.followUps.markDone(row.followUpId);
  }

  /** D2, then G15. Not fired by a merge, which archives the dropped record itself. */
  async onPatientArchived(patientId: string): Promise<void> {
    const count = await this.appointments.countUpcomingForPatient(patientId, this.clock.now());
    if (count > 0) {
      const [patient] = await this.patients.refs([patientId]);
      throw new PatientHasUpcomingAppointmentsError(patientId, patient?.fullName ?? '', count);
    }
    await this.followUps.declineAwaitingOfArchived(patientId);
  }

  /** G14: a dropped appointment overlapping a kept one is cancelled, its follow-up reopened. */
  async onPatientsMerged(droppedId: string, keptId: string): Promise<void> {
    const kept = await this.appointments.activeForPatient(keptId);
    const cancelled = new Set<string>();
    const cancel = async (row: StoredAppointment) => {
      cancelled.add(row.id);
      await this.cancelRow(await this.appointments.lock(row.id), MERGE_CANCEL_REASON);
    };
    for (const row of await this.appointments.activeForPatient(droppedId)) {
      const span = { start: row.startsAt, end: row.endsAt };
      const overlapping = kept.filter(
        (other) =>
          !cancelled.has(other.id) && overlaps(span, { start: other.startsAt, end: other.endsAt }),
      );
      if (overlapping.length === 0) continue;
      if (isWaiting(row)) {
        await cancel(row);
      } else if (overlapping.every(isWaiting)) {
        for (const other of overlapping) await cancel(other);
      } else {
        // One person arrived twice: nothing here says which visit is the real one.
        throw new MergeAppointmentsInProgressError(droppedId);
      }
    }
    await this.appointments.repointPatient(droppedId, keptId);
    await this.followUps.repointPatient(droppedId, keptId);
  }

  /** G16: their open appointments are moved or closed first. */
  async onStaffDeactivated(profileId: string): Promise<void> {
    const count = await this.appointments.countOpenForDentist(profileId);
    if (count > 0) throw new StaffHasOpenAppointmentsError(profileId, count);
  }

  // --- Helpers ---

  /** One locked status action: the column check, the presenter. */
  private act(
    id: string,
    work: (before: StoredAppointment) => Promise<StoredAppointment>,
  ): Promise<Appointment> {
    this.context.requirePermission('appointment:write');
    return this.tenantDb.run(async () => {
      const before = await this.appointments.lock(id);
      this.assertColumn(before.dentistId);
      return this.presenter.present(await work(before));
    });
  }

  private async cancelRow(
    before: StoredAppointment,
    reason: string | null,
  ): Promise<StoredAppointment> {
    assertTransition(before.status, 'cancelled');
    const row = await this.appointments.update(before.id, {
      status: 'cancelled',
      cancelReason: reason,
      closedBy: this.context.requireUserId(),
      closedAt: this.clock.now(),
    });
    await this.record('appointment.cancel', row, {
      before: { status: before.status },
      after: { status: row.status },
      reason: reason ?? undefined,
    });
    const event: AppointmentCancelled = this.events.create(APPOINTMENT_CANCELLED, {
      appointmentId: row.id,
      patientId: row.patientId,
    });
    await this.events.publish(event);
    if (row.followUpId) await this.followUps.reopen(row.followUpId);
    return row;
  }

  /** A move (CLAUDE.md §8): the row closes as `rescheduled`, a new one in its lineage takes over. */
  private async moveRow(before: StoredAppointment, values: MoveValues): Promise<StoredAppointment> {
    const { placement, span, overridden, idempotency } = values;
    const userId = this.context.requireUserId();
    await this.appointments.update(before.id, {
      status: 'rescheduled',
      closedBy: userId,
      closedAt: this.clock.now(),
    });
    const row = await this.appointments.insert({
      branchId: before.branchId,
      patientId: before.patientId,
      dentistId: values.dentistId,
      roomId: placement.pick.room?.id ?? null,
      roomAuto: placement.roomAuto,
      startsAt: span.start,
      endsAt: span.end,
      status: values.confirmed ? 'confirmed' : 'booked',
      reason: values.reason,
      visitType: values.visitType,
      planIds: before.planIds,
      followUpId: before.followUpId,
      sourceVisitId: before.sourceVisitId,
      lineageId: before.lineageId,
      overridden,
      bookedBy: userId,
      confirmedBy: values.confirmed ? userId : null,
      confirmedAt: values.confirmed ? this.clock.now() : null,
      idempotencyKey: idempotency?.key ?? null,
      idempotencyHash: idempotency?.hash ?? null,
    });
    await this.record('appointment.reschedule', row, {
      before: this.snapshot(before),
      after: this.snapshot(row),
    });
    const event: AppointmentRescheduled = this.events.create(APPOINTMENT_RESCHEDULED, {
      appointmentId: row.id,
      fromAppointmentId: before.id,
      patientId: row.patientId,
      overridden,
    });
    await this.events.publish(event);
    return row;
  }

  /** The panel's fields on the same row; nothing changed, nothing is written. */
  private async editInPlace(
    before: StoredAppointment,
    values: Omit<MoveValues, 'idempotency' | 'dentistId'>,
  ): Promise<StoredAppointment> {
    const { placement, span, overridden } = values;
    const roomId = placement.pick.room?.id ?? null;
    const confirming = values.confirmed && before.status === 'booked';
    const changed: AppointmentEditedField[] = [
      ...(values.reason !== before.reason ? (['reason'] as const) : []),
      ...(values.visitType !== before.visitType ? (['visitType'] as const) : []),
      ...(span.end.getTime() !== before.endsAt.getTime() ? (['duration'] as const) : []),
      ...(roomId !== before.roomId || placement.roomAuto !== before.roomAuto
        ? (['room'] as const)
        : []),
      ...(confirming ? (['confirmed'] as const) : []),
    ];
    if (changed.length === 0) return before;
    const row = await this.appointments.update(before.id, {
      reason: values.reason,
      visitType: values.visitType,
      endsAt: span.end,
      roomId,
      roomAuto: placement.roomAuto,
      overridden: [...new Set([...before.overridden, ...overridden])],
      ...(confirming
        ? {
            status: 'confirmed' as const,
            confirmedBy: this.context.requireUserId(),
            confirmedAt: this.clock.now(),
          }
        : {}),
    });
    await this.record('appointment.edit', row, {
      before: this.snapshot(before),
      after: this.snapshot(row),
    });
    const event: AppointmentEdited = this.events.create(APPOINTMENT_EDITED, {
      appointmentId: row.id,
      patientId: row.patientId,
      changed,
      overridden,
    });
    await this.events.publish(event);
    return row;
  }

  /** Where a span would go: the room, and every conflict a save would meet. */
  private async place(request: PlacementRequest): Promise<Placement> {
    const { branchId, dentist, patientId, span, roomChoice, ignoreAppointmentId } = request;
    const { timeZone } = await this.tenancy.currentTenant();
    const hours: readonly OpeningDay[] = await this.hours.forBranch(branchId);
    const others: BookedSpan[] = (await this.appointments.activeOverlapping(span))
      .filter((row) => row.id !== ignoreAppointmentId)
      .map((row) => ({
        start: row.startsAt,
        end: row.endsAt,
        dentistId: row.dentistId,
        patientId: row.patientId,
        roomId: row.roomId,
      }));
    const rooms = await this.activeRooms(branchId);
    const usualRoomId = await this.usualRoomId(dentist.id, branchId);
    const roomAuto = roomChoice === 'auto';
    const pick = roomAuto
      ? chooseRoom(rooms, usualRoomId, (roomId) => this.isFree(roomId, span, others))
      : this.fixedPick(rooms, roomChoice, usualRoomId);
    const conflicts = evaluateConflicts({
      span,
      dentist,
      patientId,
      room: pick.room,
      others,
      hours,
      timeZone,
    });
    return { pick, conflicts, roomAuto };
  }

  private isFree(roomId: string, span: Interval, others: readonly BookedSpan[]): boolean {
    return !others.some((other) => other.roomId === roomId && overlaps(span, other));
  }

  /** `none`: an appointment without a room stays without one. */
  private fixedPick(
    rooms: readonly RoomRef[],
    roomId: string,
    usualRoomId: string | null,
  ): AutoRoom {
    const usualRoom = rooms.find((room) => room.id === usualRoomId) ?? null;
    if (roomId === 'none') return { room: null, usualRoom, isUsual: false };
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (!room) throw new AppointmentRoomNotInBranchError(roomId);
    return { room, usualRoom, isUsual: room.id === usualRoomId };
  }

  private async activeRooms(branchId: string): Promise<RoomRef[]> {
    return (await this.tenancy.roomsOf(branchId)).filter((room) => room.active);
  }

  private async assertRoom(branchId: string, roomId: string): Promise<void> {
    if (!(await this.activeRooms(branchId)).some((room) => room.id === roomId)) {
      throw new AppointmentRoomNotInBranchError(roomId);
    }
  }

  private usualRoomId(dentistId: string, branchId: string): Promise<string | null> {
    const since = new Date(this.clock.now().getTime() - USUAL_ROOM_DAYS * 86_400_000);
    return this.visitFacts.usualRoom(dentistId, branchId, since);
  }

  private async dentistOf(
    branchId: string,
    dentistId: string,
  ): Promise<{ id: string; name: string }> {
    const practitioners = await this.users.listPractitioners({ branchId });
    const dentist = practitioners.find((item) => item.id === dentistId);
    if (!dentist) throw new AppointmentDentistNotInBranchError(dentistId);
    return { id: dentist.id, name: dentist.displayName };
  }

  private async assertSourceVisit(visitId: string, patientId: string): Promise<void> {
    const visit = await this.visitFacts.liveVisit(visitId);
    if (visit?.patientId !== patientId) throw new AppointmentNotForPatientError(visitId);
  }

  /** The column rule (A2): 403 for a colleague's appointment without `appointment:write_all`. */
  private assertColumn(dentistId: string): void {
    const allowed = canWriteAppointment(
      {
        permissions: this.context.grantedPermissions(),
        profileId: this.context.staffProfileId,
      },
      { dentistId },
    );
    if (!allowed) throw new PermissionDeniedError('appointment:write_all');
  }

  /** Hard conflicts refuse; warnings need the flag and the permission. Returns those passed. */
  private assertAllowed(
    conflicts: readonly AppointmentConflict[],
    override: boolean,
  ): ConflictKind[] {
    if (hardConflicts(conflicts).length > 0) throw new AppointmentConflictError(conflicts);
    const warnings = softConflicts(conflicts);
    if (warnings.length > 0 && !(override && this.context.hasPermission('appointment:override'))) {
      throw new AppointmentConflictError(conflicts);
    }
    return warnings.map((item) => item.kind);
  }

  private async replay(
    idempotency: { key: string; hash: string } | null,
  ): Promise<Appointment | undefined> {
    if (!idempotency) return undefined;
    await this.appointments.lockIdempotencyKey(idempotency.key);
    const first = await this.appointments.byIdempotencyKey(idempotency.key);
    if (!first) return undefined;
    if (first.idempotencyHash !== idempotency.hash) {
      throw new AppointmentIdempotencyMismatchError();
    }
    return this.presenter.present(first);
  }

  /**
   * An exclusion violation aborts the transaction, so it is caught outside it: a race then answers
   * like any other conflict, and *Auto* chooses its room again once.
   */
  private async translatingRaces(
    retry: boolean,
    work: () => Promise<Appointment>,
  ): Promise<Appointment> {
    try {
      return await work();
    } catch (error) {
      const conflict = this.conflictOf(error);
      if (!conflict) throw error;
      if (retry) return this.translatingRaces(false, work);
      throw new AppointmentConflictError([conflict]);
    }
  }

  private conflictOf(error: unknown): AppointmentConflict | null {
    const constraint = exclusionViolationOf(error);
    if (constraint === null) return null;
    const kind = constraint === 'appointments_room_no_overlap' ? 'room' : 'patient';
    return { kind, hard: true, roomName: null, dentistName: null };
  }

  private async today(): Promise<{ date: string; timeZone: string }> {
    const { timeZone } = await this.tenancy.currentTenant();
    return { date: localDate(this.clock.now(), timeZone), timeZone };
  }

  private isOpen(row: StoredAppointment): boolean {
    return isActiveAppointment(row.status);
  }

  /** The row that stands for `row` now: itself, or what it was moved to; null once closed. */
  private async currentOf(row: StoredAppointment): Promise<StoredAppointment | null> {
    if (this.isOpen(row)) return row;
    if (row.status !== 'rescheduled') return null;
    const family = await this.appointments.activeInLineage(row.lineageId);
    return family[0] ?? null;
  }

  private momentOf(row: StoredAppointment, timeZone: string) {
    return {
      status: row.status,
      localDate: localDate(row.startsAt, timeZone),
      startsAt: row.startsAt.toISOString(),
    };
  }

  private snapshot(row: StoredAppointment) {
    return {
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      dentistId: row.dentistId,
      roomId: row.roomId,
      status: row.status,
      reason: row.reason,
      visitType: row.visitType,
      overridden: row.overridden,
    };
  }

  private record(
    action: string,
    row: StoredAppointment,
    change: { before?: unknown; after?: unknown; reason?: string | undefined },
    visitId?: string,
  ): Promise<void> {
    return this.audit.record({
      action,
      resourceType: 'appointment',
      resourceId: row.id,
      patientId: row.patientId,
      visitId: visitId ?? row.sourceVisitId ?? undefined,
      ...change,
    });
  }
}
