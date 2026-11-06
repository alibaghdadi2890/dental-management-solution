import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { TenancyModule } from '../tenancy';
import { UsersModule } from '../users';
import { PayrollCurrencyLockSubscriber } from './application/currency-lock.subscriber';
import { EmployeesService } from './application/employees.service';
import { PayrollReader } from './application/payroll-reader';
import { PayrollRunsService } from './application/payroll-runs.service';
import { PayrollController } from './http/payroll.controller';
import { EmployeesRepository } from './persistence/employees.repository';
import { LinesRepository } from './persistence/lines.repository';

/**
 * See docs/modules/payroll.md and ADR-0077 to ADR-0079. Depends on `users` (the linked staff user:
 * its type and active flag, names), `tenancy` (currency, time zone, branches) and `audit`.
 * Publishes `PayrollPaymentConfirmed` / `PayrollPaymentVoided`, which `expenses` consumes in the
 * transaction; vetoes `TenantCurrencyChanged`. Nothing imports `payroll` but for those events.
 */
@Module({
  imports: [AuditModule, TenancyModule, UsersModule],
  controllers: [PayrollController],
  providers: [
    EmployeesService,
    PayrollRunsService,
    PayrollReader,
    PayrollCurrencyLockSubscriber,
    EmployeesRepository,
    LinesRepository,
  ],
})
export class PayrollModule {}
