import { DEFAULT_SPECIALTY, type PractitionerType, type Specialty } from '@dcm/contracts';
import { DomainError } from '../../../platform/kernel/domain-error';

export class StaffUserNotFoundError extends DomainError {
  readonly code = 'user.not_found';
  readonly kind = 'not_found';
}

export class LastOwnerError extends DomainError {
  readonly code = 'user.last_owner';
  readonly kind = 'conflict';
}

export class SelfDeactivationError extends DomainError {
  readonly code = 'user.self_deactivation';
  readonly kind = 'conflict';
}

export class RoleRequiredError extends DomainError {
  readonly code = 'user.role_required';
  readonly kind = 'invalid';
}

export class BranchRequiredError extends DomainError {
  readonly code = 'user.branch_required';
  readonly kind = 'invalid';
}

/** A branch id that is not an (active) branch of this clinic. */
export class UnknownBranchError extends DomainError {
  readonly code = 'user.unknown_branch';
  readonly kind = 'invalid';
}

/** A clinic always keeps at least one active owner (someone must be able to manage it later, D1). */
export function assertKeepsAnOwner(activeOwnerIds: readonly string[], leavingUserId: string): void {
  if (activeOwnerIds.includes(leavingUserId) && activeOwnerIds.length <= 1) {
    throw new LastOwnerError('The clinic must keep at least one active owner');
  }
}

export function assertNotSelf(actorUserId: string | undefined, targetUserId: string): void {
  if (actorUserId === targetUserId) {
    throw new SelfDeactivationError('You cannot deactivate your own account');
  }
}

/** Every staff user holds at least one role and works in at least one branch. */
export function assertAssignments(change: {
  roleKeys?: readonly string[] | undefined;
  branchIds?: readonly string[] | undefined;
}): void {
  if (change.roleKeys?.length === 0) {
    throw new RoleRequiredError('Assign at least one role');
  }
  if (change.branchIds?.length === 0) {
    throw new BranchRequiredError('Assign at least one branch');
  }
}

/** A dentist would be left without a specialty (ADR-0050). */
export class SpecialtyRequiredError extends DomainError {
  readonly code = 'user.specialty_required';
  readonly kind = 'invalid';
}

/** Specialties for a staff user who is not a dentist (ADR-0050). */
export class SpecialtyNotAllowedError extends DomainError {
  readonly code = 'user.specialty_not_allowed';
  readonly kind = 'invalid';
}

export interface Specialties {
  primarySpecialty: Specialty | null;
  specialties: Specialty[];
}

/**
 * What a staff profile stores after a create or a patch (`stored` is null on create): a dentist
 * keeps the specialties sent, else the stored ones (a new dentist: `DEFAULT_SPECIALTY`), and must
 * end up with one; any other type stores none, so changing a dentist to another type clears them.
 * The contract has already checked that a sent primary is among the sent specialties.
 */
export function resolveSpecialties(
  stored: (Specialties & { practitionerType: PractitionerType }) | null,
  change: {
    practitionerType?: PractitionerType | undefined;
    primarySpecialty?: Specialty | null | undefined;
    specialties?: readonly Specialty[] | undefined;
  },
): Specialties {
  const type = change.practitionerType ?? stored?.practitionerType;
  if (type !== 'dentist') {
    if (change.specialties?.length) {
      throw new SpecialtyNotAllowedError('Only a dentist has specialties');
    }
    return { primarySpecialty: null, specialties: [] };
  }
  const chosen: { primarySpecialty: Specialty | null; specialties: readonly Specialty[] } =
    change.specialties === undefined
      ? (stored ?? { primarySpecialty: DEFAULT_SPECIALTY, specialties: [DEFAULT_SPECIALTY] })
      : { primarySpecialty: change.primarySpecialty ?? null, specialties: change.specialties };
  if (chosen.primarySpecialty === null || chosen.specialties.length === 0) {
    throw new SpecialtyRequiredError('Choose at least one specialty for a dentist');
  }
  return { primarySpecialty: chosen.primarySpecialty, specialties: [...chosen.specialties] };
}
