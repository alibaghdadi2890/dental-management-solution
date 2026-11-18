import { DomainError } from '../../../platform/kernel/domain-error';

export class LabNotFoundError extends DomainError {
  readonly code = 'lab.not_found';
  readonly kind = 'not_found';
}

export class LabServiceNotFoundError extends DomainError {
  readonly code = 'lab.service_not_found';
  readonly kind = 'not_found';
}

/** Two labs of a clinic, or two services of a lab, with the same name (Part A). */
export class LabNameTakenError extends DomainError {
  readonly code = 'lab.name_taken';
  readonly kind = 'conflict';
}

export class LabServiceNameTakenError extends DomainError {
  readonly code = 'lab.service_name_taken';
  readonly kind = 'conflict';
}

/** A new order on an inactive lab or service (Part A). */
export class LabInactiveError extends DomainError {
  readonly code = 'lab.inactive';
  readonly kind = 'invalid';
}

export class LabServiceInactiveError extends DomainError {
  readonly code = 'lab.service_inactive';
  readonly kind = 'invalid';
}

export class LabOrderNotFoundError extends DomainError {
  readonly code = 'lab_order.not_found';
  readonly kind = 'not_found';
}

export class LabPaymentNotFoundError extends DomainError {
  readonly code = 'lab_payment.not_found';
  readonly kind = 'not_found';
}

export class LabPaymentVoidedError extends DomainError {
  readonly code = 'lab_payment.voided';
  readonly kind = 'conflict';
}

/** An illegal move of the order's status (B2). */
export class LabOrderTransitionError extends DomainError {
  readonly code = 'lab_order.transition';
  readonly kind = 'conflict';
}

/** An undo the order's state doesn't allow (ADR-0082). */
export class LabUndoUnavailableError extends DomainError {
  readonly code = 'lab_order.undo_unavailable';
  readonly kind = 'conflict';
}

/** Done and cancelled orders don't change. */
export class LabOrderClosedError extends DomainError {
  readonly code = 'lab_order.closed';
  readonly kind = 'conflict';
}

/** After a first sending the lab stays (cancel and create a new order). */
export class LabOrderLabLockedError extends DomainError {
  readonly code = 'lab_order.lab_locked';
  readonly kind = 'conflict';
}

/** A sent, received or payment date after today in the clinic's time zone (B2). */
export class LabFutureDateError extends DomainError {
  readonly code = 'lab_order.future_date';
  readonly kind = 'invalid';
}

/** A received date before the sent date, an expected date before sending. */
export class LabDateOrderError extends DomainError {
  readonly code = 'lab_order.date_order';
  readonly kind = 'invalid';
}

/** A service of another lab, a visit or a file of another patient, a plan item not theirs. */
export class LabOrderReferenceError extends DomainError {
  readonly code = 'lab_order.invalid_reference';
  readonly kind = 'invalid';
}

/** An appointment that is not the patient's, or not upcoming and active (B5). */
export class LabAppointmentInvalidError extends DomainError {
  readonly code = 'lab_order.appointment_invalid';
  readonly kind = 'invalid';
}

export class LabIdempotencyMismatchError extends DomainError {
  readonly code = 'lab.idempotency_mismatch';
  readonly kind = 'conflict';
}

/** Archiving a patient whose lab work is still open (Rules). */
export class PatientHasOpenLabOrdersError extends DomainError {
  readonly code = 'lab_order.patient_has_open_orders';
  readonly kind = 'conflict';
}

/** `TenantCurrencyChanged` once lab money exists (ADR-0035 extended). */
export class LabCurrencyLockedError extends DomainError {
  readonly code = 'tenant.currency_locked';
  readonly kind = 'invalid';
}
