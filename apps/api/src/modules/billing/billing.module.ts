import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { PatientsModule } from '../patients';
import { TenancyModule } from '../tenancy';
import { BillingService } from './application/billing.service';
import { BillingController } from './http/billing.controller';
import { LedgerEntriesRepository } from './persistence/ledger-entries.repository';

/**
 * See docs/modules/billing.md. Depends on `patients` (existence, create with an opening balance)
 * and `tenancy` (currency, time zone); `patients` never imports it (design Q1).
 */
@Module({
  imports: [AuditModule, PatientsModule, TenancyModule],
  controllers: [BillingController],
  providers: [BillingService, LedgerEntriesRepository],
  exports: [BillingService],
})
export class BillingModule {}
