import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { ClinicalModule } from '../clinical';
import { FilesModule } from '../files';
import { PatientsModule } from '../patients';
import { SchedulingModule } from '../scheduling';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { LabCalendar } from './application/lab-calendar';
import { LabOrderReadsService } from './application/lab-order-reads.service';
import { LabOrdersService } from './application/lab-orders.service';
import { LabsService } from './application/labs.service';
import {
  AppointmentLinkSubscriber,
  LabPatientsSubscriber,
  LabsCurrencyLockSubscriber,
} from './application/labs.subscribers';
import { OrderPresenter } from './application/order-presenter';
import { LabOrdersController } from './http/lab-orders.controller';
import { LabsController } from './http/labs.controller';
import { LabsRepository } from './persistence/labs.repository';
import { OrdersRepository } from './persistence/orders.repository';

/**
 * See docs/modules/labs.md and ADR-0081 to ADR-0086. Depends on `patients`, `users`, `tenancy`,
 * `clinical` (a visit's patient and number, plan items), `scheduling` (appointments, opening
 * hours, the appointment events), `files` (attachments) and `audit`. Reacts in the transaction to
 * the appointment events, `PatientsMerged`, `PatientArchived` and `TenantCurrencyChanged`. Only
 * `expenses` imports it, for its payment events (ADR-0085).
 */
@Module({
  imports: [
    AuditModule,
    ClinicalModule,
    FilesModule,
    PatientsModule,
    SchedulingModule,
    TenancyModule,
    UsersModule,
  ],
  controllers: [LabsController, LabOrdersController],
  providers: [
    LabCalendar,
    LabsService,
    LabOrdersService,
    LabOrderReadsService,
    OrderPresenter,
    AppointmentLinkSubscriber,
    LabPatientsSubscriber,
    LabsCurrencyLockSubscriber,
    LabsRepository,
    OrdersRepository,
  ],
  exports: [LabsService, LabOrderReadsService],
})
export class LabsModule {}
