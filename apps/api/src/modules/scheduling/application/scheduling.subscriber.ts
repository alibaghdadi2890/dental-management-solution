import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import {
  VISIT_COMPLETED,
  VISIT_DISCARDED,
  VISIT_LINKED_TO_APPOINTMENT,
  VISIT_STARTED,
  type VisitCompleted,
  type VisitDiscarded,
  type VisitLinkedToAppointment,
  type VisitStarted,
} from '../../clinical';
import {
  PATIENT_ARCHIVED,
  PATIENTS_MERGED,
  type PatientArchived,
  type PatientsMerged,
} from '../../patients';
import { BRANCH_CREATED, type BranchCreated } from '../../tenancy';
import { STAFF_DEACTIVATED, type StaffDeactivated } from '../../users';
import { AppointmentsService } from './appointments.service';
import { OpeningHoursService } from './opening-hours.service';

/**
 * What `scheduling` does in other modules' transactions (CLAUDE.md §9): a throw rolls the publisher
 * back. Not permission-gated: the publisher already required its own.
 */
@Injectable()
export class SchedulingSubscriber {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly openingHours: OpeningHoursService,
  ) {}

  @OnDomainEventInTransaction(VISIT_STARTED)
  async onVisitStarted({ payload }: VisitStarted): Promise<void> {
    if (payload.appointmentId === null) return;
    await this.appointments.onVisitStarted(
      payload.appointmentId,
      payload.patientId,
      payload.visitId,
    );
  }

  /** G9: a resumed visit took on the appointment. */
  @OnDomainEventInTransaction(VISIT_LINKED_TO_APPOINTMENT)
  onVisitLinked({ payload }: VisitLinkedToAppointment): Promise<void> {
    return this.appointments.onVisitStarted(
      payload.appointmentId,
      payload.patientId,
      payload.visitId,
    );
  }

  @OnDomainEventInTransaction(VISIT_DISCARDED)
  async onVisitDiscarded({ payload }: VisitDiscarded): Promise<void> {
    if (payload.appointmentId !== null) {
      await this.appointments.onVisitDiscarded(payload.appointmentId);
    }
  }

  @OnDomainEventInTransaction(VISIT_COMPLETED)
  onVisitCompleted({ payload }: VisitCompleted): Promise<void> {
    return this.appointments.onVisitCompleted(payload.appointmentId, payload.nextAppointment, {
      visitId: payload.visitId,
      patientId: payload.patientId,
      branchId: payload.branchId,
      dentistId: payload.dentistId,
      displayNumber: payload.displayNumber,
      localDate: payload.localDate,
    });
  }

  @OnDomainEventInTransaction(PATIENT_ARCHIVED)
  onPatientArchived({ payload }: PatientArchived): Promise<void> {
    return this.appointments.onPatientArchived(payload.patientId);
  }

  @OnDomainEventInTransaction(PATIENTS_MERGED)
  onPatientsMerged({ payload }: PatientsMerged): Promise<void> {
    return this.appointments.onPatientsMerged(payload.droppedId, payload.keptId);
  }

  @OnDomainEventInTransaction(BRANCH_CREATED)
  onBranchCreated({ payload }: BranchCreated): Promise<void> {
    return this.openingHours.seedBranch(payload.branchId);
  }

  @OnDomainEventInTransaction(STAFF_DEACTIVATED)
  onStaffDeactivated({ payload }: StaffDeactivated): Promise<void> {
    return this.appointments.onStaffDeactivated(payload.profileId);
  }
}
