import {
  AlreadyClosedError,
  CompensationNotFoundError,
  MonthNotEndedError,
  NextPeriodClosedError,
  NotClosedError,
  PreviousPeriodOpenError,
} from './compensation-errors';
import { monthOf, nextMonth, previousMonth } from './months';

/**
 * Closing and reopening a dentist's months (ADR-0059). Closed months are a prefix of their months:
 * the first month is the one of their earliest agreement, adjustment or payout, months close one
 * after the other, and only the last closed one (`lastClosed`) may reopen.
 */

/** The dentist's first month: of their earliest agreement start, adjustment or payout date. */
export function firstMonthOf(dates: readonly string[]): string | null {
  let earliest: string | null = null;
  for (const date of dates) if (earliest === null || date < earliest) earliest = date;
  return earliest === null ? null : monthOf(earliest);
}

export function assertClosable(input: {
  month: string;
  today: string;
  firstMonth: string | null;
  lastClosed: string | null;
}): void {
  const { month, today, firstMonth, lastClosed } = input;
  if (firstMonth === null || month < firstMonth) {
    throw new CompensationNotFoundError('No statement for that month', { month });
  }
  if (lastClosed !== null && month <= lastClosed) {
    throw new AlreadyClosedError('That month is already closed', { month });
  }
  if (month >= monthOf(today)) {
    throw new MonthNotEndedError('A month closes once it has ended', { month });
  }
  const expected = lastClosed === null ? firstMonth : nextMonth(lastClosed);
  if (month !== expected) {
    throw new PreviousPeriodOpenError('Close the previous month first', {
      month,
      previous: previousMonth(month),
    });
  }
}

export function assertReopenable(month: string, lastClosed: string | null): void {
  if (lastClosed === null || month > lastClosed) {
    throw new NotClosedError('That month is not closed', { month });
  }
  if (month !== lastClosed) {
    throw new NextPeriodClosedError('Reopen the next month first', {
      month,
      next: nextMonth(month),
    });
  }
}
