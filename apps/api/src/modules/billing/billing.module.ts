import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { BillingService } from './application/billing.service';
import { MergeLedgerSubscriber } from './application/merge-ledger.subscriber';
import { BILLING_QUEUE, MergeLedgerWorker } from './application/merge-ledger.worker';
import { PatientExportService } from './application/patient-export.service';
import { PatientViewsService } from './application/patient-views.service';
import { BillingPatientsController } from './http/billing-patients.controller';
import { BillingController } from './http/billing.controller';
import { LedgerEntriesRepository } from './persistence/ledger-entries.repository';

/**
 * See docs/modules/billing.md and ADR-0017. Depends on `patients` (existence, create with an
 * opening balance, the list it composes views on), `tenancy` (currency, time zone) and `users`
 * (dentist names in the export); none of them imports `billing`. Consumes `PatientsMerged`.
 */
@Module({
  imports: [
    AuditModule,
    PatientsModule,
    TenancyModule,
    UsersModule,
    BullModule.registerQueue({ name: BILLING_QUEUE }),
  ],
  // The static `patients/...` paths first (docs/modules/billing.md, HTTP).
  controllers: [BillingPatientsController, BillingController],
  providers: [
    BillingService,
    LedgerEntriesRepository,
    PatientViewsService,
    PatientExportService,
    MergeLedgerSubscriber,
    MergeLedgerWorker,
  ],
  exports: [BillingService],
})
export class BillingModule {}
