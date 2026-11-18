import {
  type DashboardQuery,
  type DateSpan,
  resolvePeriod,
  type ResolvedPeriod,
  weekStartOf,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { TenancyService } from '../../tenancy';

/** A card's period, resolved on the clinic's today (ADR-0089). */
export interface DashboardSpans {
  today: string;
  current: DateSpan;
  previous: DateSpan;
  /** The trend's months, from the clinic's first month on (a new clinic's trend starts there). */
  months: string[];
  /** The trend's Monday-weeks, from the clinic's first week on. */
  weeks: string[];
  period: ResolvedPeriod;
}

/** Resolves a card's filter into spans on the clinic's today, in the clinic time zone. */
@Injectable()
export class DashboardPeriod {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async resolve(query: DashboardQuery): Promise<DashboardSpans> {
    const tenant = await this.tenancy.currentTenant();
    const today = localDate(this.clock.now(), tenant.timeZone);
    const period = resolvePeriod(query, today);
    if (!period) {
      const message = 'A custom period has both ends, at most 24 months, and ends by today';
      throw new ValidationFailedError(message, [{ path: 'period', code: 'invalid', message }]);
    }
    const opened = localDate(new Date(tenant.createdAt), tenant.timeZone);
    const firstMonth = opened.slice(0, 7);
    const firstWeek = weekStartOf(opened);
    return {
      today,
      current: { from: period.from, to: period.to },
      previous: period.compare,
      months: period.months.filter((month) => month >= firstMonth),
      weeks: period.weeks.filter((week) => week >= firstWeek),
      period,
    };
  }
}
