import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';
import { TenancyService } from '../../tenancy';
import { LabFutureDateError } from '../domain/lab-errors';

/** "Today" in the clinic's time zone, its currency (O10), and the dates that may not be ahead. */
@Injectable()
export class LabCalendar {
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

  async currency(): Promise<string> {
    return (await this.tenancy.currentTenant()).currency;
  }

  /** The instant a local day starts, in the clinic's time zone. */
  async startOf(date: string): Promise<Date> {
    const { timeZone } = await this.tenancy.currentTenant();
    return zonedInstant(date, '00:00', timeZone);
  }

  /** Sent, received and payment dates are never in the future (B2). */
  async assertNotFuture(date: string): Promise<void> {
    if (date > (await this.today())) {
      throw new LabFutureDateError('This date is in the future', { date });
    }
  }
}
