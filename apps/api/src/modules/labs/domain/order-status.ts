import type { LabOrderStatus, LabTripOutcome, LabUndoStep } from '@dcm/contracts';
import { LabOrderTransitionError, LabUndoUnavailableError } from './lab-errors';

/**
 * An order's life (Part B, ADR-0082) as pure rules: which status each action starts from, where it
 * leads, and what one step back undoes. The services apply these to the stored rows.
 */

export type LabAction =
  | 'edit'
  | 'send'
  | 'receive'
  | 'expected'
  | 'outcome'
  | 'hold'
  | 'resume'
  | 'cancel'
  | 'link'
  | 'trip_dates';

const FROM: Readonly<Record<LabAction, readonly LabOrderStatus[]>> = {
  edit: ['to_send', 'at_lab', 'arrived', 'on_hold', 'remake'],
  send: ['to_send', 'remake'],
  receive: ['at_lab'],
  expected: ['at_lab'],
  outcome: ['arrived'],
  hold: ['to_send', 'at_lab'],
  resume: ['on_hold'],
  cancel: ['to_send', 'at_lab', 'arrived', 'on_hold', 'remake'],
  link: ['to_send', 'at_lab', 'arrived', 'on_hold', 'remake'],
  trip_dates: ['to_send', 'at_lab', 'arrived', 'on_hold', 'remake'],
};

export function canDo(action: LabAction, status: LabOrderStatus): boolean {
  return FROM[action].includes(status);
}

/** Illegal moves are refused (B2): 409 `lab_order.transition`. */
export function assertCan(action: LabAction, status: LabOrderStatus): void {
  if (!canDo(action, status)) {
    throw new LabOrderTransitionError(`An order that is ${status} can't be changed that way`, {
      action,
      status,
    });
  }
}

/** Where an outcome leads (B4, B6). */
export function statusAfterOutcome(choice: 'fitted' | LabTripOutcome): LabOrderStatus {
  if (choice === 'fitted') return 'done';
  return choice === 'remake' ? 'remake' : 'to_send';
}

/** What a step back needs to know of the order. */
export interface UndoFacts {
  status: LabOrderStatus;
  cancelledFrom: LabOrderStatus | null;
  /** The trips in order; only the last two matter. */
  trips: readonly { receivedOn: string | null; outcome: LabTripOutcome | null }[];
}

export interface UndoPlan {
  status: LabOrderStatus;
  /** What happens to the last trip. */
  trip: 'delete' | 'unreceive' | 'clear_outcome' | 'none';
}

/** A step back, or null when the order is not in the state that step left (ADR-0082). */
export function undoPlan(step: LabUndoStep, order: UndoFacts): UndoPlan | null {
  const last = order.trips.at(-1);
  const before = order.trips.at(-2);
  switch (step) {
    case 'sent':
      if (order.status !== 'at_lab' || !last || last.receivedOn !== null) return null;
      return { status: before?.outcome === 'remake' ? 'remake' : 'to_send', trip: 'delete' };
    case 'received':
      if (
        order.status !== 'arrived' ||
        !last ||
        last.receivedOn === null ||
        last.outcome !== null
      ) {
        return null;
      }
      return { status: 'at_lab', trip: 'unreceive' };
    case 'done':
      return order.status === 'done' ? { status: 'arrived', trip: 'none' } : null;
    case 'outcome':
      if ((order.status !== 'to_send' && order.status !== 'remake') || !last?.outcome) return null;
      return { status: 'arrived', trip: 'clear_outcome' };
    case 'cancel':
      return order.status === 'cancelled' && order.cancelledFrom
        ? { status: order.cancelledFrom, trip: 'none' }
        : null;
  }
}

export function requireUndoPlan(step: LabUndoStep, order: UndoFacts): UndoPlan {
  const plan = undoPlan(step, order);
  if (!plan) throw new LabUndoUnavailableError('There is nothing to undo there', { step });
  return plan;
}

export const LAB_UNDO_ORDER: readonly LabUndoStep[] = [
  'sent',
  'received',
  'done',
  'outcome',
  'cancel',
];

/** The steps back open to the order now. */
export function undoableSteps(order: UndoFacts): LabUndoStep[] {
  return LAB_UNDO_ORDER.filter((step) => undoPlan(step, order) !== null);
}

/**
 * Cancelling (D3): free before sending; for work sent and never delivered the lab may still charge;
 * after a first arrival the delivered cost stays owed and nothing more is asked.
 */
export function cancelTakesCharge(order: { tripCount: number; firstReceivedOn: string | null }) {
  return order.tripCount > 0 && order.firstReceivedOn === null;
}
