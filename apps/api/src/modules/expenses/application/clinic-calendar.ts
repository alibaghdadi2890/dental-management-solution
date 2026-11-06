import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { monthOf } from '../../../platform/kernel/months';
import { BranchNotFoundError, TenancyService } from '../../tenancy';
import { FutureDateError } from '../domain/expense-errors';

/** "Today" and "this month" in the clinic's time zone, its currency, and its branches. */
@Injectable()
export class ClinicCalendar {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  async today(): Promise<string> {
    const { timeZone } = await this.tenancy.currentTenant();
    return localDate(this.clock.now(), timeZone);
  }

  async currentMonth(): Promise<string> {
    return monthOf(await this.today());
  }

  async currency(): Promise<string> {
    return (await this.tenancy.currentTenant()).currency;
  }

  /** An expense is a payment that already happened (P3): never dated after today. */
  async assertNotFuture(date: string): Promise<void> {
    if (date > (await this.today())) {
      throw new FutureDateError('This date is in the future', { date });
    }
  }

  /** An optional branch must be an active branch of the clinic (P6). */
  async assertBranch(branchId: string | null): Promise<void> {
    if (branchId === null) return;
    if ((await this.tenancy.activeBranches([branchId])).length === 0) {
      throw new BranchNotFoundError('No such branch', { branchId });
    }
  }
}
