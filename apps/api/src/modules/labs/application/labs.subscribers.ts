import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import {
  PATIENT_ARCHIVED,
  PATIENTS_MERGED,
  type PatientArchived,
  type PatientsMerged,
} from '../../patients';
import {
  APPOINTMENT_BOOKED,
  APPOINTMENT_CANCELLED,
  APPOINTMENT_COMPLETED,
  APPOINTMENT_MARKED_NO_SHOW,
  APPOINTMENT_RESCHEDULED,
  type AppointmentBooked,
  type AppointmentCancelled,
  type AppointmentCompleted,
  type AppointmentMarkedNoShow,
  type AppointmentRescheduled,
} from '../../scheduling';
import { TENANT_CURRENCY_CHANGED, type TenantCurrencyChanged } from '../../tenancy';
import { LabCurrencyLockedError } from '../domain/lab-errors';
import { LabOrdersService } from './lab-orders.service';
import { LabsService } from './labs.service';

/**
 * The appointment link follows `scheduling` (ADR-0084), in the transaction of the booking, the
 * move, the cancel, the no-show and the completion: a booking links the patient's open orders that
 * have none, a reschedule carries the link, the others remove it.
 */
@Injectable()
export class AppointmentLinkSubscriber {
  constructor(private readonly orders: LabOrdersService) {}

  @OnDomainEventInTransaction(APPOINTMENT_BOOKED)
  async onBooked(event: AppointmentBooked): Promise<void> {
    await this.orders.onAppointmentBooked(event.payload.appointmentId, event.payload.patientId);
  }

  @OnDomainEventInTransaction(APPOINTMENT_RESCHEDULED)
  async onRescheduled(event: AppointmentRescheduled): Promise<void> {
    await this.orders.onAppointmentRescheduled(
      event.payload.fromAppointmentId,
      event.payload.appointmentId,
    );
  }

  @OnDomainEventInTransaction(APPOINTMENT_CANCELLED)
  async onCancelled(event: AppointmentCancelled): Promise<void> {
    await this.orders.onAppointmentClosed(event.payload.appointmentId, 'cancelled');
  }

  @OnDomainEventInTransaction(APPOINTMENT_MARKED_NO_SHOW)
  async onNoShow(event: AppointmentMarkedNoShow): Promise<void> {
    await this.orders.onAppointmentClosed(event.payload.appointmentId, 'no_show');
  }

  @OnDomainEventInTransaction(APPOINTMENT_COMPLETED)
  async onCompleted(event: AppointmentCompleted): Promise<void> {
    await this.orders.onAppointmentClosed(event.payload.appointmentId, 'completed');
  }
}

/** A merge moves the dropped patient's orders; an archive waits until none is open (Rules). */
@Injectable()
export class LabPatientsSubscriber {
  constructor(private readonly orders: LabOrdersService) {}

  @OnDomainEventInTransaction(PATIENTS_MERGED)
  async onMerged(event: PatientsMerged): Promise<void> {
    await this.orders.onPatientsMerged(event.payload.droppedId, event.payload.keptId);
  }

  @OnDomainEventInTransaction(PATIENT_ARCHIVED)
  async onArchived(event: PatientArchived): Promise<void> {
    await this.orders.onPatientArchived(event.payload.patientId);
  }
}

/** The currency lock (ADR-0035) extended to labs (O10). */
@Injectable()
export class LabsCurrencyLockSubscriber {
  constructor(private readonly labs: LabsService) {}

  @OnDomainEventInTransaction(TENANT_CURRENCY_CHANGED)
  async onCurrencyChanged(event: TenantCurrencyChanged): Promise<void> {
    if (await this.labs.hasMoney()) {
      throw new LabCurrencyLockedError(
        `This clinic has lab money in ${event.payload.from}; its currency can't change`,
      );
    }
  }
}
