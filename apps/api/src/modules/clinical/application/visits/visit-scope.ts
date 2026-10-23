import { inVisitScope, ownsVisit, type VisitOwnership } from '@dcm/contracts';
import type { RequestContext } from '../../../../platform/cls/request-context';
import { VisitNotFoundError } from '../../domain/visit-errors';
import type { VisitOwner } from '../../persistence/visit-search.sql';

/**
 * The visit scope in `clinical` (ADR-0055, `RequestContext.visitScope`): which visits a query
 * lists, which a load by id finds, and whose money a row shows. A visit outside the caller's scope
 * is not found, like another tenant's (RLS).
 */

/** What a query must add: `undefined` = every visit, `null` = none, else the caller's own. */
export function ownedFilter(context: RequestContext): VisitOwner | null | undefined {
  const scope = context.visitScope();
  if (scope.kind === 'all') return undefined;
  if (scope.kind === 'none') return null;
  return { userId: scope.userId, profileId: scope.profileId };
}

/** A visit loaded by id for the caller: outside their scope it is not found. */
export function assertVisitInScope(context: RequestContext, visit: VisitOwnership): void {
  if (!inVisitScope(context.visitScope(), visit)) {
    throw new VisitNotFoundError('Visit not found');
  }
}

/**
 * Whether a visit row shows its money (ADR-0055): with `payment:read` (one patient's account),
 * or on the caller's own visit, which a dentist always sees the prices of.
 */
export function visitMoneyVisible(context: RequestContext, visit: VisitOwnership): boolean {
  return (
    context.hasPermission('payment:read') ||
    ownsVisit({ userId: context.userId ?? null, profileId: context.staffProfileId }, visit)
  );
}
