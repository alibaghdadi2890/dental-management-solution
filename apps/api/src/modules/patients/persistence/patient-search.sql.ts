import { phoneDigits } from '@dcm/contracts';
import {
  and,
  type AnyColumn,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { nameKey } from '../domain/name-key';
import type { MatchedContactSummary } from '../domain/patient';
import type { PatientRankKeys } from '../domain/rank-keys';
import { joinLinkedPatient, resolvedFullName, resolvedPhoneSearch } from './contact-resolution.sql';
import { contacts, patientContacts, patients } from './schema';

/** `active`/`notSeen` (currently identical — design Q14) map to `deleted_at is null`. */
export type PatientView = 'active' | 'notSeen' | 'archived';

export interface PatientSearchFilters {
  view: PatientView;
  /**
   * Diacritics-insensitive name substring, or number/e-mail/phone-digits substring; phone digits
   * also match the resolved phone of the patient's contacts (design addendum C7).
   */
  q?: string;
  /** A practitioner's staff profile id (ADR-0020), or the literal `'none'` for "no dentist". */
  dentist?: string;
  /** Exclusive lower bound: `date_of_birth > dobAfter`. */
  dobAfter?: string;
  /** Inclusive upper bound: `date_of_birth <= dobOnOrBefore`. */
  dobOnOrBefore?: string;
  alerts?: 'yes' | 'no';
}

export type PatientSortKey = 'name' | 'age' | 'recent' | 'dentist' | 'balance';

/**
 * `sort=dentist`/`sort=balance` order by an integer key per row (design Q7):
 * `coalesce(keys[array_position(ids, <column>)], restKey)`, then `name_key`, then `id`.
 * `column: 'id'` ranks patients directly (billing's balance order); `'primaryDentistId'` ranks by
 * the practitioner (staff profile id) each patient is assigned to (resolved by the caller via
 * `users`). `keys[i]`
 * is the key of `ids[i]`; rows whose column is not among `ids` (or is null) get `restKey`. Equal
 * keys tie, so the name order decides between them: callers give equal values (the same balance,
 * two dentists with the same name) the same key. The caller encodes the direction in the keys;
 * `PatientSearchOptions.dir` is ignored for these two sorts. Never exposed over HTTP.
 */
export interface PatientRank extends PatientRankKeys {
  column: 'id' | 'primaryDentistId';
}

export interface PatientSearchOptions {
  page: number;
  size: number;
  sort: PatientSortKey;
  /** Ignored when `sort` is `'dentist'` or `'balance'` — see `PatientRank`. */
  dir: 'asc' | 'desc';
  /** Restricts the result to these ids; an empty array matches nothing (never "all"). */
  idsIn?: readonly string[];
  /** Required when `sort` is `'dentist'` or `'balance'` (see `PatientRank`). */
  rank?: PatientRank;
}

/** What the order depends on: the sort, its direction and the rank for ranked sorts. */
export type PatientOrderOptions = Pick<PatientSearchOptions, 'sort' | 'dir' | 'rank'>;

/** Escapes LIKE/ILIKE metacharacters so user input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

const MIN_PHONE_QUERY_DIGITS = 2;

/**
 * A name-key order in the "C" collation (code-point order of the UTF-8 bytes), so an order made in
 * SQL can be continued in the application byte for byte (the lookup merges its contact and patient
 * halves, `ContactsService.lookup`), whatever the database's default collation.
 */
export function byNameKey(nameKeyColumn: AnyColumn | SQL): SQL {
  return sql`(${nameKeyColumn}) collate "C"`;
}

/**
 * The search-or-create lookup's match (addendum C5), over any pair of name-key and phone-search
 * expressions (a patient's own columns, or a contact's resolved ones): a diacritics-insensitive
 * name substring, or, when `q` has at least 2 digits, a phone-digits substring.
 */
export function lookupMatch(
  nameKeyColumn: AnyColumn | SQL,
  phoneSearchColumn: AnyColumn | SQL,
  q: string,
): SQL {
  const conditions: SQL[] = [sql`${nameKeyColumn} like ${`%${escapeLike(nameKey(q))}%`}`];
  const digits = phoneDigits(q);
  if (digits.length >= MIN_PHONE_QUERY_DIGITS) {
    conditions.push(sql`${phoneSearchColumn} like ${`%${escapeLike(digits)}%`}`);
  }
  return or(...conditions) ?? sql`false`;
}

/**
 * A query typed as a patient number (`P-000123`, `p000123`): it is looked up among display
 * numbers only. Its digits would otherwise also match any phone containing them.
 */
const PATIENT_NUMBER_QUERY = /^p-?(\d+)$/i;

/**
 * The whole id list bound as one `uuid[]` parameter (`sql.param` lets node-postgres serialise it
 * as a native array): one placeholder however many ids, unlike `inArray`'s one per id.
 */
export function uuidArray(ids: readonly string[]): SQL {
  return sql`${sql.param([...ids])}::uuid[]`;
}

/** `column = any(ids)`, with `ids` bound as a single array parameter (`uuidArray`). */
export function idAmong(column: AnyColumn, ids: readonly string[]): SQL {
  return sql`${column} = any(${uuidArray(ids)})`;
}

/**
 * What a search `q` matches: `own` over the patient's own columns, and — for a phone query (at
 * least 2 digits, not a patient number) — `contactPhone`, the LIKE pattern matched against the
 * resolved phone digits of the patient's live contacts.
 */
interface QueryMatch {
  own: SQL;
  contactPhone: string | null;
}

function queryMatch(q: string): QueryMatch {
  const patientNumber = PATIENT_NUMBER_QUERY.exec(q);
  if (patientNumber) {
    return {
      own: ilike(patients.displayNumber, `%P-${patientNumber[1] ?? ''}%`),
      contactPhone: null,
    };
  }
  const escapedQ = escapeLike(q);
  const qNameKey = escapeLike(nameKey(q));
  const own: SQL[] = [
    like(patients.nameKey, `%${qNameKey}%`),
    ilike(patients.displayNumber, `%${escapedQ}%`),
    ilike(patients.email, `%${escapedQ}%`),
  ];
  const qDigits = phoneDigits(q);
  if (qDigits.length < MIN_PHONE_QUERY_DIGITS) {
    return { own: or(...own) ?? sql`false`, contactPhone: null };
  }
  const pattern = `%${escapeLike(qDigits)}%`;
  // A patient without a phone has a null `phone_search`: the LIKE is null, never a match.
  own.push(like(patients.phoneSearch, pattern));
  return { own: or(...own) ?? sql`false`, contactPhone: pattern };
}

/**
 * The patients having a live contact whose resolved phone digits match `pattern`. Uncorrelated,
 * so Postgres evaluates it once per query (a hashed subplan), whatever the number of patients.
 */
function patientIdsByContactPhone(pattern: string): SQL {
  return sql`${patients.id} in (
    select ${patientContacts.patientId} from ${patientContacts}
    inner join ${contacts} on ${contacts.id} = ${patientContacts.contactId}
    ${joinLinkedPatient}
    where ${contacts.deletedAt} is null and ${resolvedPhoneSearch} like ${pattern}
  )`;
}

export function whereFor(filters: PatientSearchFilters, idsIn: readonly string[] | undefined): SQL {
  const conditions: SQL[] = [];

  if (filters.view === 'archived') {
    conditions.push(isNotNull(patients.deletedAt));
  } else {
    conditions.push(isNull(patients.deletedAt));
  }

  if (filters.q) {
    const match = queryMatch(filters.q);
    const qCondition =
      match.contactPhone === null
        ? match.own
        : or(match.own, patientIdsByContactPhone(match.contactPhone));
    if (qCondition) conditions.push(qCondition);
  }

  if (filters.dentist === 'none') {
    conditions.push(isNull(patients.primaryDentistId));
  } else if (filters.dentist) {
    conditions.push(eq(patients.primaryDentistId, filters.dentist));
  }

  if (filters.dobAfter) conditions.push(gt(patients.dateOfBirth, filters.dobAfter));
  if (filters.dobOnOrBefore) conditions.push(lte(patients.dateOfBirth, filters.dobOnOrBefore));

  if (filters.alerts === 'yes') {
    conditions.push(sql`cardinality(${patients.medicalAlerts}) > 0`);
  } else if (filters.alerts === 'no') {
    conditions.push(sql`cardinality(${patients.medicalAlerts}) = 0`);
  }

  if (idsIn) conditions.push(idAmong(patients.id, idsIn));

  return and(...conditions) ?? sql`true`;
}

/**
 * The `matchedContact` column of a search row (design addendum C7): for a patient that a phone
 * query matched only through a contact, that contact (the primary guardian first, then the oldest
 * link) as `{ fullName, relationship }` JSON; null otherwise, and a constant null when `q` is not a
 * phone query. The correlated subquery runs only for rows the patient's own columns did not match.
 */
export function matchedContactColumn(
  filters: PatientSearchFilters,
): SQL<MatchedContactSummary | null> {
  const match = filters.q ? queryMatch(filters.q) : undefined;
  if (!match || match.contactPhone === null) return sql<null>`null::json`;
  return sql<MatchedContactSummary | null>`case when ${match.own} then null else (
    select json_build_object('fullName', ${resolvedFullName}, 'relationship', ${patientContacts.relationship})
    from ${patientContacts}
    inner join ${contacts} on ${contacts.id} = ${patientContacts.contactId}
    ${joinLinkedPatient}
    where ${patientContacts.patientId} = ${patients.id}
      and ${contacts.deletedAt} is null
      and ${resolvedPhoneSearch} like ${match.contactPhone}
    order by ${patientContacts.isPrimaryGuardian} desc, ${patientContacts.createdAt}, ${patientContacts.contactId}
    limit 1
  ) end`;
}

/**
 * Orders by the requested sort, always tie-broken by `name_key` then `id` for stable paging.
 * `sort=age`: ascending age (youngest first) means the *most recent* date of birth first, so the
 * date-of-birth direction is inverted relative to `dir`; patients with no date of birth always
 * sort last, in either direction. `sort=recent` ignores `dir` — it always means "most recently
 * updated first" (documented design choice: there is no meaningful "least recently updated" saved
 * view). `sort=dentist`/`'balance'` require `options.rank` and ignore `dir` (design Q7).
 */
export function orderByFor(options: PatientOrderOptions): SQL[] {
  const idTieBreak = sql`${patients.id} asc`;
  const tieBreak = [sql`${patients.nameKey} asc`, idTieBreak];
  switch (options.sort) {
    case 'name':
      return [
        sql`${patients.nameKey} ${options.dir === 'desc' ? sql`desc` : sql`asc`}`,
        idTieBreak,
      ];
    case 'age': {
      const dobDirection = options.dir === 'desc' ? sql`asc` : sql`desc`;
      return [sql`${patients.dateOfBirth} ${dobDirection} nulls last`, ...tieBreak];
    }
    case 'recent':
      return [sql`${patients.updatedAt} desc`, ...tieBreak];
    case 'dentist':
    case 'balance': {
      if (!options.rank) {
        throw new Error(`search: sort=${options.sort} requires a rank option`);
      }
      const { column, ids, keys, restKey } = assertRank(options.rank);
      const ranked = column === 'primaryDentistId' ? patients.primaryDentistId : patients.id;
      const position = sql`array_position(${uuidArray(ids)}, ${ranked})`;
      return [
        sql`coalesce((${sql.param([...keys])}::int[])[${position}], ${restKey}::int)`,
        ...tieBreak,
      ];
    }
  }
}

const INT4_MAX = 2_147_483_647;

function isInt4(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= INT4_MAX;
}

/** A malformed rank is the calling service's programming error: refused before any SQL runs. */
function assertRank(rank: PatientRank): PatientRank {
  if (rank.ids.length !== rank.keys.length) {
    throw new RangeError(
      `search: rank has ${String(rank.ids.length)} ids but ${String(rank.keys.length)} keys`,
    );
  }
  if (!rank.keys.every(isInt4) || !isInt4(rank.restKey)) {
    throw new RangeError('search: rank keys must be 32-bit integers');
  }
  return rank;
}
