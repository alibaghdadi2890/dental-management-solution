import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { BillingModule } from '../billing';
import { ClinicalModule } from '../clinical';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { CompensationService } from './application/compensation.service';
import { DeactivationSubscriber } from './application/deactivation.subscriber';
import { VisitRedateSubscriber } from './application/visit-redate.subscriber';
import { StatementReader } from './application/statement-reader';
import { CompensationController } from './http/compensation.controller';
import { AgreementsRepository } from './persistence/agreements.repository';
import { AdjustmentsRepository, PayoutsRepository } from './persistence/money-rows.repository';
import { PeriodsRepository } from './persistence/periods.repository';

/**
 * See docs/modules/compensation.md and ADR-0058–0060. Depends on `users` (dentists, the
 * deactivation event), `clinical` (completed visits, catalog categories), `billing` (the ledger's
 * visit entries and collections), `patients` (names on lines), `tenancy` (currency, time zone)
 * and `audit`; none of them imports `compensation`. Consumes `StaffDeactivated` in its
 * transaction.
 */
@Module({
  imports: [AuditModule, BillingModule, ClinicalModule, PatientsModule, TenancyModule, UsersModule],
  controllers: [CompensationController],
  providers: [
    CompensationService,
    StatementReader,
    DeactivationSubscriber,
    VisitRedateSubscriber,
    AgreementsRepository,
    AdjustmentsRepository,
    PayoutsRepository,
    PeriodsRepository,
  ],
})
export class CompensationModule {}
