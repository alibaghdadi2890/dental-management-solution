import { EXPIRING_DAYS_DEFAULT } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { BranchNotFoundError, TenancyService } from '../../tenancy';
import { InventoryFutureDateError } from '../domain/inventory-errors';
import { CatalogRepository } from '../persistence/catalog.repository';

/**
 * "Today" in the clinic's time zone (expired and expiring are judged on it), the clinic's
 * currency (I10), its branches, and the expiring window (D9).
 */
@Injectable()
export class InventoryCalendar {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly catalog: CatalogRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  async today(): Promise<string> {
    const { timeZone } = await this.tenancy.currentTenant();
    return localDate(this.clock.now(), timeZone);
  }

  async currency(): Promise<string> {
    return (await this.tenancy.currentTenant()).currency;
  }

  async expiringDays(): Promise<number> {
    return (await this.catalog.expiringDays()) ?? EXPIRING_DAYS_DEFAULT;
  }

  /** Received, paid and ordered dates are never ahead of today; only an expiry is. */
  async assertNotFuture(date: string | null): Promise<void> {
    if (date !== null && date > (await this.today())) {
      throw new InventoryFutureDateError('This date is in the future', { date });
    }
  }

  /** Stock is kept per branch (I2): a branch of the clinic, active. */
  async assertBranch(branchId: string): Promise<void> {
    if ((await this.tenancy.activeBranches([branchId])).length === 0) {
      throw new BranchNotFoundError('No such branch', { branchId });
    }
  }

  async branchIds(): Promise<string[]> {
    return (await this.tenancy.allActiveBranches()).map((branch) => branch.id);
  }
}
