import {
  addDays,
  LAB_EXPECTED_SOON_DAYS,
  LAB_TODAY_REASONS,
  type LabOrderStatus,
  type LabPriority,
  type LabTodayReason,
} from '@dcm/contracts';
import { isLate } from './lab-dates';

/**
 * Today's Lab work lane (C3): what needs a hand. An order appears once, under its most urgent
 * reason: late; not arrived for an appointment today or on the next open day; not sent yet (from
 * the day it is created: *Mark sent* is the next step); at the lab and expected within
 * `LAB_EXPECTED_SOON_DAYS`; arrived with no appointment booked. Dates are the clinic's local dates.
 */

export interface LaneFacts {
  status: LabOrderStatus;
  priority: LabPriority;
  expectedOn: string | null;
  /** The linked appointment's local date, when it is still ahead and active. */
  appointmentDate: string | null;
  waitingSince: string;
  receivedOn: string | null;
  createdAt: string;
}

const NOT_ARRIVED: readonly LabOrderStatus[] = ['to_send', 'at_lab', 'remake', 'on_hold'];
const UNSENT: readonly LabOrderStatus[] = ['to_send', 'remake'];

export function laneReason(
  order: LaneFacts,
  today: string,
  nextOpenDay: string,
): LabTodayReason | null {
  if (isLate(order.status, order.expectedOn, today)) return 'late';
  if (
    NOT_ARRIVED.includes(order.status) &&
    (order.appointmentDate === today || order.appointmentDate === nextOpenDay)
  ) {
    return 'due';
  }
  if (UNSENT.includes(order.status)) return 'not_sent';
  if (
    order.status === 'at_lab' &&
    order.expectedOn !== null &&
    order.expectedOn <= addDays(today, LAB_EXPECTED_SOON_DAYS)
  ) {
    return 'expected';
  }
  if (order.status === 'arrived' && order.appointmentDate === null) return 'book';
  return null;
}

/** The date a row is ranked by within its reason: the earliest first. */
function dateOf(reason: LabTodayReason, order: LaneFacts): string {
  switch (reason) {
    case 'late':
      return order.expectedOn ?? '';
    case 'due':
      return order.appointmentDate ?? '';
    case 'not_sent':
      return order.waitingSince;
    case 'expected':
      return order.expectedOn ?? '';
    case 'book':
      return order.receivedOn ?? '';
  }
}

/** The lane: most urgent reason first, then urgent priority, then the earliest date. */
export function lane<T extends LaneFacts>(
  orders: readonly T[],
  today: string,
  nextOpenDay: string,
): { reason: LabTodayReason; order: T }[] {
  const rows = orders.flatMap((order) => {
    const reason = laneReason(order, today, nextOpenDay);
    return reason ? [{ reason, order }] : [];
  });
  const rank = (reason: LabTodayReason) => LAB_TODAY_REASONS.indexOf(reason);
  return rows.sort((a, b) => {
    if (a.reason !== b.reason) return rank(a.reason) - rank(b.reason);
    if (a.order.priority !== b.order.priority) return a.order.priority === 'urgent' ? -1 : 1;
    const da = dateOf(a.reason, a.order);
    const db = dateOf(b.reason, b.order);
    if (da !== db) return da < db ? -1 : 1;
    return a.order.createdAt < b.order.createdAt ? -1 : 1;
  });
}
