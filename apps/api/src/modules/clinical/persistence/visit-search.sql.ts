import type { VisitStatus } from '@dcm/contracts';
import { and, eq, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { visits, visitServices } from './schema';

/**
 * What the visits list, its summary and the Unpaid/export routes filter on (4b, spec
 * §VisitsService), already resolved by the service: the branch or patient scope, the tab's
 * statuses, the date filter's first local date, and a text match over the visit number, its
 * services and the patients `q` found.
 */
export interface VisitCriteria {
  /** The session branch's visits, or one patient's in every branch (the record's history). */
  scope: { branchId: string } | { patientId: string };
  statuses: readonly VisitStatus[];
  fromDate?: string | undefined;
  dentistId?: string | undefined;
  roomId?: string | undefined;
  match?: VisitTextMatch | undefined;
  /** Restricts to these visits (`billing`'s Unpaid tab); an empty list matches nothing. */
  idsIn?: readonly string[] | undefined;
}

export interface VisitTextMatch {
  /** The visit number when `q` reads as one (`V-123`, `123`). */
  displayNumber?: number | undefined;
  /** Matched against a non-removed service's code and name. */
  text: string;
  /** The patients `q` matched (`PatientsService.searchIds`). */
  patientIds: readonly string[];
}

/** LIKE wildcards in user text match themselves. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const uuidList = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;

export function scopeCondition(scope: VisitCriteria['scope']): SQL {
  return 'branchId' in scope
    ? eq(visits.branchId, scope.branchId)
    : eq(visits.patientId, scope.patientId);
}

function textCondition(match: VisitTextMatch): SQL {
  const pattern = `%${escapeLike(match.text)}%`;
  const conditions: SQL[] = [
    sql`exists (select 1 from ${visitServices} where ${visitServices.visitId} = ${visits.id} and ${isNull(visitServices.deletedAt)} and (${visitServices.code} ilike ${pattern} or ${visitServices.name} ilike ${pattern}))`,
  ];
  if (match.displayNumber !== undefined) {
    conditions.push(eq(visits.displayNumber, match.displayNumber));
  }
  if (match.patientIds.length > 0) {
    conditions.push(sql`${visits.patientId} = any(${uuidList(match.patientIds)})`);
  }
  return or(...conditions) ?? sql`false`;
}

export function whereFor(criteria: VisitCriteria): SQL {
  const conditions: SQL[] = [
    scopeCondition(criteria.scope),
    inArray(visits.status, [...criteria.statuses]),
  ];
  if (criteria.fromDate !== undefined) conditions.push(gte(visits.localDate, criteria.fromDate));
  if (criteria.dentistId !== undefined) conditions.push(eq(visits.dentistId, criteria.dentistId));
  if (criteria.roomId !== undefined) conditions.push(eq(visits.roomId, criteria.roomId));
  if (criteria.match !== undefined) conditions.push(textCondition(criteria.match));
  if (criteria.idsIn !== undefined) {
    conditions.push(sql`${visits.id} = any(${uuidList(criteria.idsIn)})`);
  }
  return and(...conditions) ?? sql`true`;
}
