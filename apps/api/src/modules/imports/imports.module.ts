import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { ClinicalModule } from '../clinical';
import { PatientsModule } from '../patients';
import { ImportsService } from './application/imports.service';
import { ImportsController } from './http/imports.controller';

/**
 * Imports from a previous system (docs/modules/imports.md, ADR-0053): writes only through the
 * services of `patients`, `billing` (opening balances) and `clinical` (catalog, visits); owns no
 * tables yet. Nothing imports this module.
 */
@Module({
  imports: [PatientsModule, BillingModule, ClinicalModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
