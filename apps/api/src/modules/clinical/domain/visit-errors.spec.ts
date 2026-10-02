import { describe, expect, it } from 'vitest';
import {
  AmendNoChangeError,
  AmendPlanLinkedError,
  AmendUnknownServiceError,
  BranchRequiredError,
  CurrencyMismatchError,
  DentistInvalidError,
  IllegalVisitTransitionError,
  PlanNotCancellableError,
  PlanNotOpenError,
  RecordNotFoundError,
  RecordNotRemovableError,
  RoomBusyError,
  RoomInvalidError,
  RoomRequiredError,
  SurfacesInvalidError,
  ToothNotAllowedError,
  ToothRequiredError,
  VisitMovedError,
  VisitNotEmptyError,
  VisitNotFoundError,
  VisitNotAmendableError,
  VisitNotLiveError,
  VisitNotVoidableError,
  VisitStaleError,
} from './visit-errors';

/**
 * `kind` is what `platform/errors/problem-details.ts` maps to the HTTP status (`invalid` → 422,
 * `not_found` → 404, `conflict` → 409); `domain/` can't import the mapper, so the pairs are
 * pinned here (as in `patients/domain/patient-errors.spec.ts`).
 */
describe('visit domain errors', () => {
  it.each([
    [new VisitNotFoundError('x'), 'visit.not_found', 'not_found'],
    [new VisitNotLiveError('x'), 'visit.not_live', 'conflict'],
    [new IllegalVisitTransitionError('x'), 'visit.illegal_transition', 'conflict'],
    [new RoomBusyError('x'), 'visit.room_busy', 'conflict'],
    [new VisitNotEmptyError('x'), 'visit.not_empty', 'conflict'],
    [new VisitMovedError('x'), 'visit.moved', 'conflict'],
    [new RecordNotRemovableError('x'), 'record.not_removable', 'conflict'],
    [new RecordNotFoundError('x'), 'record.not_found', 'not_found'],
    [new PlanNotOpenError('x'), 'plan.not_open', 'conflict'],
    [new PlanNotCancellableError('x'), 'plan.not_cancellable', 'conflict'],
    [new BranchRequiredError('x'), 'visit.branch_required', 'invalid'],
    [new DentistInvalidError('x'), 'visit.dentist_invalid', 'invalid'],
    [new RoomInvalidError('x'), 'visit.room_invalid', 'invalid'],
    [new RoomRequiredError('x'), 'visit.room_required', 'invalid'],
    [new ToothRequiredError('x'), 'visit.tooth_required', 'invalid'],
    [new ToothNotAllowedError('x'), 'visit.tooth_not_allowed', 'invalid'],
    [new SurfacesInvalidError('x'), 'visit.surfaces_invalid', 'invalid'],
    [new CurrencyMismatchError('x'), 'visit.currency_mismatch', 'invalid'],
    [new VisitNotAmendableError('x'), 'visit.not_amendable', 'conflict'],
    [new VisitNotVoidableError('x'), 'visit.not_voidable', 'conflict'],
    [new VisitStaleError('x'), 'visit.stale', 'conflict'],
    [new AmendNoChangeError('x'), 'visit.amend_no_change', 'invalid'],
    [new AmendUnknownServiceError('x'), 'visit.amend_unknown_service', 'invalid'],
    [new AmendPlanLinkedError('x'), 'visit.amend_plan_linked', 'invalid'],
  ])('%s carries code %s and kind %s', (error, code, kind) => {
    expect(error.code).toBe(code);
    expect(error.kind).toBe(kind);
  });

  it('a visit that is not live is an illegal transition too', () => {
    expect(new VisitNotLiveError('x')).toBeInstanceOf(IllegalVisitTransitionError);
  });
});
