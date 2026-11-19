import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { ClinicalModule } from '../clinical';
import { CompensationModule } from '../compensation';
import { ExpensesModule } from '../expenses';
import { InventoryModule } from '../inventory';
import { LabsModule } from '../labs';
import { PatientsModule } from '../patients';
import { PayrollModule } from '../payroll';
import { SchedulingModule } from '../scheduling';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { DashboardPeriod } from './application/dashboard-period';
import { FinancialDashboardService } from './application/financial-dashboard.service';
import { OperationalDashboardService } from './application/operational-dashboard.service';
import { DashboardsController } from './http/dashboards.controller';

/**
 * See docs/modules/dashboards.md and ADR-0087 to ADR-0092. Owns no tables: every figure comes
 * from the summary of the module that holds its facts (`billing`, `clinical`, `scheduling`,
 * `patients`, `expenses`, `payroll`, `compensation`, `labs`, `inventory`), with `tenancy` and `users` for the
 * clinic and the names. No module imports `dashboards`.
 */
@Module({
  imports: [
    BillingModule,
    ClinicalModule,
    CompensationModule,
    ExpensesModule,
    InventoryModule,
    LabsModule,
    PatientsModule,
    PayrollModule,
    SchedulingModule,
    TenancyModule,
    UsersModule,
  ],
  controllers: [DashboardsController],
  providers: [DashboardPeriod, FinancialDashboardService, OperationalDashboardService],
})
export class DashboardsModule {}
