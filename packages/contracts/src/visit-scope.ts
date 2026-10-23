import type { Permission } from './permissions.js';

/**
 * Who reads a visit (feature 13a, ADR-0055): the first resource-level rule. `visit:read` is the
 * caller's own visits — they are its dentist (by staff profile id, ADR-0020) or they started it —
 * and `visit:read_all` every visit of the tenant. A pure rule on the caller and the row, so the
 * API and the SPA apply the same one (CLAUDE.md §6).
 */
export interface VisitActor {
  permissions: Iterable<Permission>;
  /** The auth user id. */
  userId: string | null;
  /** The caller's staff profile id in this tenant; null without one. */
  profileId: string | null;
}

export type VisitScope =
  { kind: 'all' } | { kind: 'own'; userId: string; profileId: string | null } | { kind: 'none' };

export interface VisitOwnership {
  /** A staff profile id. */
  dentistId: string;
  /** The auth user id who started it. */
  startedBy: string;
}

export function visitScopeOf(actor: VisitActor): VisitScope {
  const held = new Set(actor.permissions);
  if (held.has('visit:read_all')) return { kind: 'all' };
  if (held.has('visit:read') && actor.userId !== null) {
    return { kind: 'own', userId: actor.userId, profileId: actor.profileId };
  }
  return { kind: 'none' };
}

/** Whether the visit is the caller's own: its dentist or its starter (no permission involved). */
export function ownsVisit(
  actor: Pick<VisitActor, 'userId' | 'profileId'>,
  visit: VisitOwnership,
): boolean {
  return (
    (actor.profileId !== null && visit.dentistId === actor.profileId) ||
    (actor.userId !== null && visit.startedBy === actor.userId)
  );
}

export function inVisitScope(scope: VisitScope, visit: VisitOwnership): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'none') return false;
  return ownsVisit(scope, visit);
}

export function canReadVisit(actor: VisitActor, visit: VisitOwnership): boolean {
  return inVisitScope(visitScopeOf(actor), visit);
}
