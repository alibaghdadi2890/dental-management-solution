import {
  daysBetween,
  fromCents,
  type LabRemakeBorneBy,
  type LabReportFigures,
  type LabTripOutcome,
  toCents,
} from '@dcm/contracts';

/**
 * The lab reports (Part E) over a period, each figure counted on the day its event happened, with
 * the orders behind it. Turnaround and punctuality are per trip received; remakes and adjustments
 * are among the orders received.
 */

export interface ReportTrip {
  sentOn: string;
  promisedOn: string;
  receivedOn: string | null;
  outcome: LabTripOutcome | null;
  outcomeOn: string | null;
  remakeBorneBy: LabRemakeBorneBy | null;
  remakeCharge: string | null;
}

export interface ReportOrder {
  id: string;
  cost: string;
  firstReceivedOn: string | null;
  doneOn: string | null;
  cancelledOn: string | null;
  cancelCharge: string | null;
  trips: readonly ReportTrip[];
}

const round = (value: number) => Math.round(value * 100) / 100;
const share = (part: number, whole: number) => (whole === 0 ? null : round(part / whole));
const mean = (values: readonly number[]) =>
  values.length === 0 ? null : round(values.reduce((sum, value) => sum + value, 0) / values.length);

export function reportFigures(
  orders: readonly ReportOrder[],
  from: string,
  to: string,
  withMoney: boolean,
): LabReportFigures {
  const within = (date: string | null): date is string =>
    date !== null && date >= from && date <= to;
  const ids = {
    sent: new Set<string>(),
    received: new Set<string>(),
    done: new Set<string>(),
    cancelled: new Set<string>(),
    late: new Set<string>(),
    remakes: new Set<string>(),
    adjustments: new Set<string>(),
    delivered: new Set<string>(),
  };
  let sent = 0;
  let received = 0;
  const turnarounds: number[] = [];
  const delays: number[] = [];
  let onTime = 0;
  const remakeLab = new Set<string>();
  const remakeClinic = new Set<string>();
  let cost = 0n;

  for (const order of orders) {
    if (within(order.doneOn)) ids.done.add(order.id);
    if (within(order.cancelledOn)) {
      ids.cancelled.add(order.id);
      if (order.cancelCharge !== null) cost += toCents(order.cancelCharge);
    }
    if (within(order.firstReceivedOn)) {
      ids.delivered.add(order.id);
      cost += toCents(order.cost);
    }
    for (const trip of order.trips) {
      if (within(trip.sentOn)) {
        sent += 1;
        ids.sent.add(order.id);
      }
      if (within(trip.receivedOn)) {
        received += 1;
        ids.received.add(order.id);
        turnarounds.push(daysBetween(trip.sentOn, trip.receivedOn));
        if (trip.receivedOn <= trip.promisedOn) onTime += 1;
        else {
          ids.late.add(order.id);
          delays.push(daysBetween(trip.promisedOn, trip.receivedOn));
        }
        if (trip.outcome === 'remake') {
          ids.remakes.add(order.id);
          (trip.remakeBorneBy === 'clinic' ? remakeClinic : remakeLab).add(order.id);
        }
        if (trip.outcome === 'adjustment') ids.adjustments.add(order.id);
      }
      if (within(trip.outcomeOn) && trip.remakeCharge !== null) cost += toCents(trip.remakeCharge);
    }
  }

  const receivedOrders = ids.received.size;
  const list = (set: Set<string>) => [...set];
  return {
    sent,
    received,
    done: ids.done.size,
    cancelled: ids.cancelled.size,
    avgTurnaroundDays: mean(turnarounds),
    onTimeRate: share(onTime, received),
    avgDelayDays: mean(delays),
    remakeRate: share(ids.remakes.size, receivedOrders),
    remakeLabRate: share(remakeLab.size, receivedOrders),
    remakeClinicRate: share(remakeClinic.size, receivedOrders),
    adjustmentRate: share(ids.adjustments.size, receivedOrders),
    totalCost: withMoney ? fromCents(cost) : null,
    avgCost:
      withMoney && ids.delivered.size > 0 ? fromCents(cost / BigInt(ids.delivered.size)) : null,
    orderIds: {
      sent: list(ids.sent),
      received: list(ids.received),
      done: list(ids.done),
      cancelled: list(ids.cancelled),
      late: list(ids.late),
      remakes: list(ids.remakes),
      adjustments: list(ids.adjustments),
      delivered: list(ids.delivered),
    },
  };
}
