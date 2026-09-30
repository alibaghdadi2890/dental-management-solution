import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { ClinicalModule } from '../clinical';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { BillingService } from './application/billing.service';
import { MergeLedgerSubscriber } from './application/merge-ledger.subscriber';
import { LedgerWriter } from './application/ledger-writer';
import { BILLING_QUEUE, MergeLedgerWorker } from './application/merge-ledger.worker';
import { PatientExportService } from './application/patient-export.service';
import { PatientViewsService } from './application/patient-views.service';
import { VisitChargeSubscriber } from './application/visit-charge.subscriber';
import { BillingPatientsController } from './http/billing-patients.controller';
import { BillingController } from './http/billing.controller';
import { LedgerEntriesRepository } from './persistence/ledger-entries.repository';

/**
 * See docs/modules/billing.md, ADR-0017 and ADR-0024. Depends on `patients` (existence, create
 * with an opening balance, the list it composes views on), `tenancy` (currency, time zone),
 * `users` (dentist names in the export) and `clinical` (a visit's charge facts and money, W21);
 * none of them imports `billing`. Consumes `PatientsMerged`, and `VisitCompleted` in the
 * completion's transaction.
 */
@Module({
  imports: [
    AuditModule,
    ClinicalModule,
    PatientsModule,
    TenancyModule,
    UsersModule,
    BullModule.registerQueue({ name: BILLING_QUEUE }),
  ],
  // The static `patients/...` paths first (docs/modules/billing.md, HTTP).
  controllers: [BillingPatientsController, BillingController],
  providers: [
    BillingService,
    LedgerWriter,
    LedgerEntriesRepository,
    PatientViewsService,
    PatientExportService,
    MergeLedgerSubscriber,
    MergeLedgerWorker,
    VisitChargeSubscriber,
  ],
  exports: [BillingService],
})
export class BillingModule {}
