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

/**
 * Defensive guard in `lockPatientThenVisit` (ADR-0023, W24): after locking the visit's patient,
 * the visit's own row locked a different patient than that. It should be unreachable — a merge
 * re-points a visit inside the same transaction that locks the visit's old patient `FOR UPDATE`
 * (E3, `feat(clinical): re-point visits and records in the merge transaction`), so either our
 * `FOR SHARE` lock blocks that merge until we are done, or the merge already committed and
 * `lockForDependentWrite` throws `PatientMergedError` first — never both locks succeeding on a
 * stale pairing. Kept so a caller that somehow hits it gets a clean 409 to retry instead of the
 * service recursing while it still holds the visit's `FOR UPDATE` lock, which would lock a new
 * patient after the visit — the reverse of the ADR-0023 order.
 */
export class VisitMovedError extends DomainError {
  readonly code = 'visit.moved';
  readonly kind = 'conflict';
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

/** Only records made in this visit can be removed from it, and only records made outside a visit
 * from the patient record; others are resolved or cancelled (W13, ADR-0031). */
export class RecordNotRemovableError extends DomainError {
  readonly code = 'record.not_removable';
  readonly kind = 'conflict';
}

/**
 * No such service, diagnosis or plan on the visit's patient (a service: in the visit). A record of
 * another patient reads as not found through this visit.
 */
export class RecordNotFoundError extends DomainError {
  readonly code = 'record.not_found';
  readonly kind = 'not_found';
}

/** A record made outside a visit names no dentist and the caller isn't one (ADR-0031, P4). */
export class RecordDentistRequiredError extends DomainError {
  readonly code = 'record.dentist_required';
  readonly kind = 'invalid';
}

/** Starting, performing, cancelling or removing a plan in a status that doesn't allow it. */
export class PlanNotOpenError extends DomainError {
  readonly code = 'plan.not_open';
  readonly kind = 'conflict';
}

/** Continuing, or undoing a session of, a plan that isn't in progress (ADR-0032). */
export class PlanNotInProgressError extends DomainError {
  readonly code = 'plan.not_in_progress';
  readonly kind = 'conflict';
}

/** Cancel is for plans from an earlier visit; a plan made in this visit is removed (W13). */
export class PlanNotCancellableError extends DomainError {
  readonly code = 'plan.not_cancellable';
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

/** A `per_jaw` or `per_mouth` item recorded on a tooth (spec W11). */
export class ToothNotAllowedError extends DomainError {
  readonly code = 'visit.tooth_not_allowed';
  readonly kind = 'invalid';
}

/** A `per_jaw` item recorded without its jaw (levels, L2). */
export class JawRequiredError extends DomainError {
  readonly code = 'visit.jaw_required';
  readonly kind = 'invalid';
}

/** A jaw given for a `per_tooth` or `per_mouth` item (levels, L2). */
export class JawNotAllowedError extends DomainError {
  readonly code = 'visit.jaw_not_allowed';
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

// --- Amend and void (feature 4b) ---

/** Only a completed (or already amended) visit is amended (D4). */
export class VisitNotAmendableError extends DomainError {
  readonly code = 'visit.not_amendable';
  readonly kind = 'conflict';
}

/** Only a completed (or amended) visit is voided; a voided one stays voided (D4). */
export class VisitNotVoidableError extends DomainError {
  readonly code = 'visit.not_voidable';
  readonly kind = 'conflict';
}

/** The visit changed since the client read it (`expectedUpdatedAt`, D8): reload and retry. */
export class VisitStaleError extends DomainError {
  readonly code = 'visit.stale';
  readonly kind = 'conflict';
}

/** The amendment changes nothing. */
export class AmendNoChangeError extends DomainError {
  readonly code = 'visit.amend_no_change';
  readonly kind = 'invalid';
}

/** An amendment names a service the visit doesn't have, or the same one twice. */
export class AmendUnknownServiceError extends DomainError {
  readonly code = 'visit.amend_unknown_service';
  readonly kind = 'invalid';
}

/** A service that performed a plan can be removed, not re-toothed (D2). */
export class AmendPlanLinkedError extends DomainError {
  readonly code = 'visit.amend_plan_linked';
  readonly kind = 'invalid';
}

/** Only a completed or amended visit has a checkout to close (ADR-0033). */
export class VisitNotCompletedError extends DomainError {
  readonly code = 'visit.not_completed';
  readonly kind = 'conflict';
}

/** A checkout discount after the visit's day (checkout handoff, C5): amend the visit instead. */
export class VisitCheckoutClosedError extends DomainError {
  readonly code = 'visit.checkout_closed';
  readonly kind = 'conflict';
}
