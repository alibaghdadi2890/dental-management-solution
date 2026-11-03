import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { ClinicalModule } from '../clinical';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { AppointmentPresenter } from './application/appointment-presenter';
import { AppointmentsService } from './application/appointments.service';
import { FollowUpsService } from './application/follow-ups.service';
import { OpeningHoursService } from './application/opening-hours.service';
import { SchedulingSubscriber } from './application/scheduling.subscriber';
import { SchedulingController } from './http/scheduling.controller';
import { AppointmentsRepository } from './persistence/appointments.repository';
import { FollowUpsRepository } from './persistence/follow-ups.repository';
import { OpeningHoursRepository } from './persistence/opening-hours.repository';

/**
 * See docs/modules/scheduling.md and ADR-0066–0072. Depends on `tenancy` (branches, rooms, time
 * zone), `users` (dentists), `patients` (names, the booking lock), `clinical` (the visit events, the
 * usual room) and `audit`. `alerts` reads who is waiting through `AppointmentsService`.
 */
@Module({
  imports: [AuditModule, ClinicalModule, PatientsModule, TenancyModule, UsersModule],
  controllers: [SchedulingController],
  providers: [
    AppointmentPresenter,
    AppointmentsService,
    FollowUpsService,
    OpeningHoursService,
    SchedulingSubscriber,
    AppointmentsRepository,
    FollowUpsRepository,
    OpeningHoursRepository,
  ],
  exports: [AppointmentsService],
})
export class SchedulingModule {}
