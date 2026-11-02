import type { Appointment, AppointmentLineage } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { isUnresolved } from '../domain/appointment-lifecycle';
import {
  AppointmentsRepository,
  type LineageRow,
  type StoredAppointment,
} from '../persistence/appointments.repository';
import { FollowUpsRepository } from '../persistence/follow-ups.repository';

function lineageOf(row: StoredAppointment, rows: readonly LineageRow[]): AppointmentLineage {
  const family = rows.filter((candidate) => candidate.lineageId === row.lineageId);
  const position = family.findIndex((candidate) => candidate.id === row.id);
  return {
    moves: family.filter((candidate) => candidate.status === 'rescheduled').length,
    firstStartsAt: (family[0]?.startsAt ?? row.startsAt).toISOString(),
    movedToStartsAt:
      row.status === 'rescheduled' ? (family[position + 1]?.startsAt.toISOString() ?? null) : null,
  };
}

/** Rows to the read model, resolving names in batches. Reads through the caller's transaction. */
@Injectable()
export class AppointmentPresenter {
  constructor(
    private readonly appointments: AppointmentsRepository,
    private readonly followUps: FollowUpsRepository,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async present(row: StoredAppointment): Promise<Appointment> {
    const [appointment] = await this.presentAll([row]);
    if (!appointment) throw new Error('presenting an appointment returned nothing');
    return appointment;
  }

  async presentAll(rows: readonly StoredAppointment[]): Promise<Appointment[]> {
    if (rows.length === 0) return [];
    const followUps = await this.followUps.byIds(
      rows.flatMap((row) => (row.followUpId ? [row.followUpId] : [])),
    );
    const dentistIds = [
      ...rows.map((row) => row.dentistId),
      ...followUps.map((followUp) => followUp.recommendedBy),
    ];
    const practitioners = await this.users.practitionersByProfileIds(dentistIds);
    const dentistNames = new Map(practitioners.map((item) => [item.id, item.displayName]));
    const patients = new Map(
      (await this.patients.refs(rows.map((row) => row.patientId))).map((patient) => [
        patient.id,
        patient,
      ]),
    );
    const rooms = new Map((await this.tenancy.roomsOf()).map((room) => [room.id, room.name]));
    const bookers = await this.users.namesByUserIds(rows.map((row) => row.bookedBy));
    const lineages = await this.appointments.lineages(rows.map((row) => row.lineageId));
    const followUpsById = new Map(followUps.map((followUp) => [followUp.id, followUp]));
    const { timeZone } = await this.tenancy.currentTenant();
    const now = this.clock.now();

    return rows.map((row) => {
      const patient = patients.get(row.patientId);
      if (!patient) throw new Error(`appointment ${row.id} has no patient`);
      const followUp = row.followUpId ? followUpsById.get(row.followUpId) : undefined;
      return {
        id: row.id,
        branchId: row.branchId,
        patient,
        dentistId: row.dentistId,
        dentistName: dentistNames.get(row.dentistId) ?? '',
        roomId: row.roomId,
        roomName: row.roomId ? (rooms.get(row.roomId) ?? null) : null,
        roomAuto: row.roomAuto,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        localDate: localDate(row.startsAt, timeZone),
        status: row.status,
        reason: row.reason,
        visitType: row.visitType,
        planIds: row.planIds,
        followUp: followUp
          ? {
              id: followUp.id,
              title: followUp.title,
              sourceVisitNumber: followUp.sourceVisitNumber,
              recommendedByName: dentistNames.get(followUp.recommendedBy) ?? '',
            }
          : null,
        sourceVisitId: row.sourceVisitId,
        lineageId: row.lineageId,
        lineage: lineageOf(row, lineages),
        overridden: row.overridden,
        bookedByName: bookers.get(row.bookedBy) ?? '',
        createdAt: row.createdAt.toISOString(),
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
        checkedInAt: row.checkedInAt?.toISOString() ?? null,
        cancelReason: row.cancelReason,
        unresolved: isUnresolved(row.status, row.endsAt, now),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
}
