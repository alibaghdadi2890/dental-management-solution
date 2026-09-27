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
import { patients } from './schema';

/** `active`/`notSeen` (currently identical — design Q14) map to `deleted_at is null`. */
export type PatientView = 'active' | 'notSeen' | 'archived';

export interface PatientSearchFilters {
  view: PatientView;
  /** Diacritics-insensitive name substring, or number/e-mail/phone-digits substring. */
  q?: string;
  /** A practitioner's auth user id, or the literal `'none'` for "no dentist assigned". */
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
 * `column: 'id'` ranks patients directly (billing's balance order); `'primaryDentistUserId'` ranks
 * by the practitioner each patient is assigned to (resolved by the caller via `users`). `keys[i]`
 * is the key of `ids[i]`; rows whose column is not among `ids` (or is null) get `restKey`. Equal
 * keys tie, so the name order decides between them: callers give equal values (the same balance,
 * two dentists with the same name) the same key. The caller encodes the direction in the keys;
 * `PatientSearchOptions.dir` is ignored for these two sorts. Never exposed over HTTP.
 */
export interface PatientRank {
  column: 'id' | 'primaryDentistUserId';
  ids: readonly string[];
  /** One per id, same length as `ids`; 32-bit integers (bound as Postgres `int[]`). */
  keys: readonly number[];
  restKey: number;
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

/** Escapes LIKE/ILIKE metacharacters so user input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

const MIN_PHONE_QUERY_DIGITS = 2;

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

export function whereFor(filters: PatientSearchFilters, idsIn: readonly string[] | undefined): SQL {
  const conditions: SQL[] = [];

  if (filters.view === 'archived') {
    conditions.push(isNotNull(patients.deletedAt));
  } else {
    conditions.push(isNull(patients.deletedAt));
  }

  if (filters.q) {
    const patientNumber = PATIENT_NUMBER_QUERY.exec(filters.q);
    if (patientNumber) {
      conditions.push(ilike(patients.displayNumber, `%P-${patientNumber[1] ?? ''}%`));
    } else {
      const escapedQ = escapeLike(filters.q);
      const qNameKey = escapeLike(nameKey(filters.q));
      const ors: SQL[] = [
        like(patients.nameKey, `%${qNameKey}%`),
        ilike(patients.displayNumber, `%${escapedQ}%`),
        ilike(patients.email, `%${escapedQ}%`),
      ];
      const qDigits = phoneDigits(filters.q);
      if (qDigits.length >= MIN_PHONE_QUERY_DIGITS) {
        ors.push(like(patients.phoneSearch, `%${escapeLike(qDigits)}%`));
      }
      const qCondition = or(...ors);
      if (qCondition) conditions.push(qCondition);
    }
  }

  if (filters.dentist === 'none') {
    conditions.push(isNull(patients.primaryDentistUserId));
  } else if (filters.dentist) {
    conditions.push(eq(patients.primaryDentistUserId, filters.dentist));
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
 * Orders by the requested sort, always tie-broken by `name_key` then `id` for stable paging.
 * `sort=age`: ascending age (youngest first) means the *most recent* date of birth first, so the
 * date-of-birth direction is inverted relative to `dir`; patients with no date of birth always
 * sort last, in either direction. `sort=recent` ignores `dir` — it always means "most recently
 * updated first" (documented design choice: there is no meaningful "least recently updated" saved
 * view). `sort=dentist`/`'balance'` require `options.rank` and ignore `dir` (design Q7).
 */
export function orderByFor(options: PatientSearchOptions): SQL[] {
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
      const ranked =
        column === 'primaryDentistUserId' ? patients.primaryDentistUserId : patients.id;
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
