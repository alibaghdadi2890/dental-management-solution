import { DomainError } from '../../../platform/kernel/domain-error';

/** No visit with this id in the tenant; a discarded visit reads as not found too (spec W4). */
export class VisitNotFoundError extends DomainError {
  readonly code = 'visit.not_found';
  readonly kind = 'not_found';
}

/**
 * A lifecycle action the visit's status doesn't allow (`visit-lifecycle.ts`). Among live
 * statuses that is only a same-state pause or resume, which the service answers idempotently
 * before asking the state machine, so over HTTP this surfaces almost always as its
 * `VisitNotLiveError` specialisation.
 */
export class IllegalVisitTransitionError extends DomainError {
  readonly code: string = 'visit.illegal_transition';
  readonly kind = 'conflict';
}

/**
 * The visit is completed or discarded: nothing about it changes any more (spec §Domain rules). A
 * second `complete` lands here, so a retried request can't double-charge.
 */
export class VisitNotLiveError extends IllegalVisitTransitionError {
  override readonly code = 'visit.not_live';
}

/** Another live visit already holds the room (`visits_room_live_unique`, spec W1). */
export class RoomBusyError extends DomainError {
  readonly code = 'visit.room_busy';
  readonly kind = 'conflict';
}

/** Discard is only for an empty visit (`discard-rule.ts`, spec W4). */
export class VisitNotEmptyError extends DomainError {
  readonly code = 'visit.not_empty';
  readonly kind = 'conflict';
}

/** Only records made in this visit can be removed; older ones are resolved or cancelled (W13). */
export class RecordNotRemovableError extends DomainError {
  readonly code = 'record.not_removable';
  readonly kind = 'conflict';
}

/** Performing or cancelling a plan that is no longer `planned`. */
export class PlanNotOpenError extends DomainError {
  readonly code = 'plan.not_open';
  readonly kind = 'conflict';
}

/** A visit starts in the session's active branch; there is none. */
export class BranchRequiredError extends DomainError {
  readonly code = 'visit.branch_required';
  readonly kind = 'invalid';
}

/** `dentistId` is not an active dentist-type practitioner assigned to the branch (ADR-0020). */
export class DentistInvalidError extends DomainError {
  readonly code = 'visit.dentist_invalid';
  readonly kind = 'invalid';
}

/** `roomId` is not an active room of the branch. */
export class RoomInvalidError extends DomainError {
  readonly code = 'visit.room_invalid';
  readonly kind = 'invalid';
}

/** The branch has active rooms, so the visit must name one (spec W7). */
export class RoomRequiredError extends DomainError {
  readonly code = 'visit.room_required';
  readonly kind = 'invalid';
}

/** A `per_tooth` item, or any diagnosis, recorded without a tooth (spec W11). */
export class ToothRequiredError extends DomainError {
  readonly code = 'visit.tooth_required';
  readonly kind = 'invalid';
}

/** A `per_jaw` item recorded on a tooth (spec W11). */
export class ToothNotAllowedError extends DomainError {
  readonly code = 'visit.tooth_not_allowed';
  readonly kind = 'invalid';
}

/** Surfaces the tooth doesn't have (`validSurfaces`), or surfaces without a tooth. */
export class SurfacesInvalidError extends DomainError {
  readonly code = 'visit.surfaces_invalid';
  readonly kind = 'invalid';
}

/** A price in a currency other than the visit's, which is fixed at start (spec W12). */
export class CurrencyMismatchError extends DomainError {
  readonly code = 'visit.currency_mismatch';
  readonly kind = 'invalid';
}
