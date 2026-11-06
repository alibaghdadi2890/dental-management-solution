import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { TENANT_CURRENCY_CHANGED, type TenantCurrencyChanged } from '../../tenancy';
import { PayrollCurrencyLockedError } from '../domain/payroll-errors';
import { EmployeesRepository } from '../persistence/employees.repository';

/**
 * The currency lock (ADR-0035) extended to payroll: once any salary is recorded, a change of the
 * clinic's currency is refused in its transaction. Salary entries are never deleted.
 */
@Injectable()
export class PayrollCurrencyLockSubscriber {
  constructor(private readonly employees: EmployeesRepository) {}

  @OnDomainEventInTransaction(TENANT_CURRENCY_CHANGED)
  async onCurrencyChanged(event: TenantCurrencyChanged): Promise<void> {
    if (await this.employees.anySalary()) {
      throw new PayrollCurrencyLockedError(
        `This clinic has salaries in ${event.payload.from}; its currency can't change`,
      );
    }
  }
}
