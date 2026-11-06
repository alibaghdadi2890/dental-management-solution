import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { OnDomainEvent, OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import {
  PAYOUT_RECORDED,
  PAYOUT_VOIDED,
  type PayoutRecorded,
  type PayoutVoided,
} from '../../compensation';
import {
  PAYROLL_PAYMENT_CONFIRMED,
  PAYROLL_PAYMENT_VOIDED,
  type PayrollPaymentConfirmed,
  type PayrollPaymentVoided,
} from '../../payroll';
import { TENANT_PROVISIONED, type TenantProvisioned } from '../../provisioning';
import { TENANT_CURRENCY_CHANGED, type TenantCurrencyChanged } from '../../tenancy';
import { UsersService } from '../../users';
import { ExpenseCurrencyLockedError } from '../domain/expense-errors';
import { CategoriesService } from './categories.service';
import { ExpensesService } from './expenses.service';

/**
 * Every new clinic starts with the predefined categories (D7). Consumes `provisioning`'s event
 * without depending on its services (ADR-0014), after the commit, as a system task inside the new
 * tenant. A failure is logged and never rethrown: the categories list adds missing ones itself.
 */
@Injectable()
export class CategorySeedingSubscriber {
  private readonly logger = new Logger(CategorySeedingSubscriber.name);

  constructor(
    private readonly context: RequestContext,
    private readonly categories: CategoriesService,
  ) {}

  @OnDomainEvent(TENANT_PROVISIONED)
  async onTenantProvisioned(event: TenantProvisioned): Promise<void> {
    const { tenantId } = event.payload;
    try {
      await this.context.run(
        { requestId: event.requestId ?? event.id, actorKind: 'system', tenantId },
        () => this.categories.seedDefaults(),
      );
    } catch (error) {
      this.logger.error({ err: error, tenantId }, 'seeding the expense categories failed');
    }
  }
}

/**
 * The currency lock (ADR-0035) extended to expenses: once the clinic has recorded any expense or
 * fixed expense, `tenancy`'s currency change is refused in its transaction.
 */
@Injectable()
export class ExpensesCurrencyLockSubscriber {
  constructor(private readonly expenses: ExpensesService) {}

  @OnDomainEventInTransaction(TENANT_CURRENCY_CHANGED)
  async onCurrencyChanged(event: TenantCurrencyChanged): Promise<void> {
    if (await this.expenses.hasMoney()) {
      throw new ExpenseCurrencyLockedError(
        `This clinic has recorded expenses in ${event.payload.from}; its currency can't change`,
      );
    }
  }
}

/**
 * Dentist payouts appear in Expenses by themselves (P2, ADR-0076): a payout recorded writes a
 * read-only Dentist compensation row, and a payout voided voids it, in the payout's transaction.
 */
@Injectable()
export class PayoutMirrorSubscriber {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly users: UsersService,
  ) {}

  @OnDomainEventInTransaction(PAYOUT_RECORDED)
  async onPayoutRecorded(event: PayoutRecorded): Promise<void> {
    const { id, profileId, date, amount, currency, method, reference, note } = event.payload;
    const [dentist] = await this.users.practitionersByProfileIds([profileId]);
    await this.expenses.recordMirror({
      source: 'compensation',
      sourceId: id,
      spentOn: date,
      amount,
      currency,
      method,
      payee: dentist?.displayName ?? null,
      reference,
      description: note,
      branchId: null,
      sourceMonth: null,
    });
  }

  @OnDomainEventInTransaction(PAYOUT_VOIDED)
  async onPayoutVoided(event: PayoutVoided): Promise<void> {
    await this.expenses.voidMirror('compensation', event.payload.id, event.payload.reason);
  }
}

/**
 * A salary is never typed as an expense (P4): a confirmed payroll line writes a read-only
 * Salaries row for its net, and voiding the payment voids it, in the payroll transaction
 * (ADR-0076).
 */
@Injectable()
export class SalaryMirrorSubscriber {
  constructor(private readonly expenses: ExpensesService) {}

  @OnDomainEventInTransaction(PAYROLL_PAYMENT_CONFIRMED)
  async onPaymentConfirmed(event: PayrollPaymentConfirmed): Promise<void> {
    const { paymentId, employeeName, month, net, currency, paidOn, method, branchId } =
      event.payload;
    await this.expenses.recordMirror({
      source: 'payroll',
      sourceId: paymentId,
      spentOn: paidOn,
      amount: net,
      currency,
      method,
      payee: employeeName,
      reference: null,
      description: null,
      branchId,
      sourceMonth: month,
    });
  }

  @OnDomainEventInTransaction(PAYROLL_PAYMENT_VOIDED)
  async onPaymentVoided(event: PayrollPaymentVoided): Promise<void> {
    await this.expenses.voidMirror('payroll', event.payload.paymentId, event.payload.reason);
  }
}
