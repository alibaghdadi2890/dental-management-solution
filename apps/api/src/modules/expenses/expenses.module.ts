import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { CategoriesService } from './application/categories.service';
import { ClinicCalendar } from './application/clinic-calendar';
import { ExpensesService } from './application/expenses.service';
import {
  CategorySeedingSubscriber,
  ExpensesCurrencyLockSubscriber,
  PayoutMirrorSubscriber,
  SalaryMirrorSubscriber,
} from './application/expenses.subscribers';
import { FixedExpensesService } from './application/fixed-expenses.service';
import { ExpensesController } from './http/expenses.controller';
import { CategoriesRepository } from './persistence/categories.repository';
import { ExpensesRepository } from './persistence/expenses.repository';
import { FixedExpensesRepository } from './persistence/fixed-expenses.repository';

/**
 * See docs/modules/expenses.md and ADR-0076, ADR-0078. Depends on `tenancy` (currency, time
 * zone, branches), `users` (the dentist named on a mirrored payout) and `audit`. Reacts in the
 * transaction to `compensation`'s payout events and `payroll`'s payment events (the mirrors) and
 * to `TenantCurrencyChanged` (the lock), and after the commit to `TenantProvisioned`. Nothing
 * imports `expenses`.
 */
@Module({
  imports: [AuditModule, TenancyModule, UsersModule],
  controllers: [ExpensesController],
  providers: [
    CategoriesService,
    ClinicCalendar,
    ExpensesService,
    FixedExpensesService,
    CategorySeedingSubscriber,
    ExpensesCurrencyLockSubscriber,
    PayoutMirrorSubscriber,
    SalaryMirrorSubscriber,
    CategoriesRepository,
    ExpensesRepository,
    FixedExpensesRepository,
  ],
})
export class ExpensesModule {}
