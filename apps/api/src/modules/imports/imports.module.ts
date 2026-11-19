import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { ClinicalModule } from '../clinical';
import { InventoryModule } from '../inventory';
import { PatientsModule } from '../patients';
import { ImportsService } from './application/imports.service';
import { ImportsController } from './http/imports.controller';

/**
 * Imports from a previous system (docs/modules/imports.md, ADR-0053): writes only through the
 * services of `patients`, `billing` (opening balances), `clinical` (catalog, visits) and
 * `inventory` (items and opening stock, feature 20a); owns no
 * tables yet. Nothing imports this module.
 */
@Module({
  imports: [PatientsModule, BillingModule, ClinicalModule, InventoryModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
