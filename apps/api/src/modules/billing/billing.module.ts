import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { ClinicalModule } from '../clinical';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { BillingService } from './application/billing.service';
import { ChargeLabels } from './application/charge-labels';
import { CurrencyLockSubscriber } from './application/currency-lock.subscriber';
import { MergeLedgerSubscriber } from './application/merge-ledger.subscriber';
import { LedgerWriter } from './application/ledger-writer';
import { PatientExportService } from './application/patient-export.service';
import { PatientViewsService } from './application/patient-views.service';
import { PaymentViewsService } from './application/payment-views.service';
import { PaymentsService } from './application/payments.service';
import { Settlement } from './application/settlement';
import { VisitChargeSubscriber } from './application/visit-charge.subscriber';
import { VisitViewsService } from './application/visit-views.service';
import { BillingPatientsController } from './http/billing-patients.controller';
import { BillingPaymentsController } from './http/billing-payments.controller';
import { BillingVisitsController } from './http/billing-visits.controller';
import { BillingController } from './http/billing.controller';
import { AllocationsRepository } from './persistence/allocations.repository';
import { LedgerEntriesRepository } from './persistence/ledger-entries.repository';
import { PaymentsRepository } from './persistence/payments.repository';

/**
 * See docs/modules/billing.md, ADR-0017 and ADR-0024. Depends on `patients` (existence, create
 * with an opening balance, the list it composes views on), `tenancy` (currency, time zone),
 * `users` (dentist names in the export) and `clinical` (a visit's charge facts and money, W21);
 * none of them imports `billing`. Consumes `PatientsMerged`, `VisitCompleted`, `VisitAmended`,
 * `VisitVoided` and `TenantCurrencyChanged` in their transactions. Payments (feature 5): ADR-0027–0029.
 */
@Module({
  imports: [AuditModule, ClinicalModule, PatientsModule, TenancyModule, UsersModule],
  // The static `patients/...` and `visits/...` paths first (docs/modules/billing.md, HTTP).
  controllers: [
    BillingPatientsController,
    BillingVisitsController,
    BillingPaymentsController,
    BillingController,
  ],
  providers: [
    BillingService,
    LedgerWriter,
    LedgerEntriesRepository,
    AllocationsRepository,
    PaymentsRepository,
    Settlement,
    ChargeLabels,
    PaymentsService,
    PaymentViewsService,
    PatientViewsService,
    PatientExportService,
    MergeLedgerSubscriber,
    VisitChargeSubscriber,
    CurrencyLockSubscriber,
    VisitViewsService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
