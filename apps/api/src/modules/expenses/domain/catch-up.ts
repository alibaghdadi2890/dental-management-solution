import type { FixedExpenseStatus } from '@dcm/contracts';
import { monthsBetween, nextMonth } from '../../../platform/kernel/months';

/**
 * The catch-up of a fixed expense (ADR-0078). There is no job: whenever the clinic looks, an
 * active template gets one item per month from `nextMonth` through the current month (in the
 * clinic's time zone), and `nextMonth` moves past it. A paused or ended template generates
 * nothing, and a first month in the future generates nothing until it comes.
 */
export function catchUp(
  template: { status: FixedExpenseStatus; nextMonth: string },
  currentMonth: string,
): { months: string[]; nextMonth: string } {
  if (template.status !== 'active') return { months: [], nextMonth: template.nextMonth };
  const months = monthsBetween(template.nextMonth, currentMonth);
  return {
    months,
    nextMonth: months.length > 0 ? nextMonth(currentMonth) : template.nextMonth,
  };
}

/** Resuming skips the paused months: generation starts again at the current month at the latest. */
export function resumedNextMonth(next: string, currentMonth: string): string {
  return next > currentMonth ? next : currentMonth;
}
