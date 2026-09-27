import type { PatientSex } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import {
  and,
  eq,
  getTableColumns,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { newId } from '../../../platform/kernel/id';
import { nameKey } from '../domain/name-key';
import { PatientNotFoundError } from '../domain/patient-errors';
import type { DomainPatient } from '../domain/patient';
import { patients } from './schema';

type PatientRow = typeof patients.$inferSelect;

function toDomain(row: PatientRow): DomainPatient {
  return {
    id: row.id,
    displayNumber: row.displayNumber,
    fullName: row.fullName,
    nameKey: row.nameKey,
    phone: row.phone,
    phoneSearch: row.phoneSearch,
    dateOfBirth: row.dateOfBirth,
    sex: row.sex,
    email: row.email,
    address: row.address,
    insurance: row.insurance,
    emergencyContact: row.emergencyContact,
    notes: row.notes,
    medicalAlerts: row.medicalAlerts,
    primaryDentistUserId: row.primaryDentistUserId,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    externalId: row.externalId,
    mergedIntoId: row.mergedIntoId,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A phone already normalised against the tenant's country (`@dcm/contracts` `normalizePhone`).
 * The repository stores `e164` and derives `phone_search` from both fields — passed in explicit
 * form rather than a raw string so a caller can never accidentally write an unnormalised number.
 */
export interface NormalizedPhoneInput {
  e164: string;
  national: string;
}

function phoneSearchOf(phone: NormalizedPhoneInput): string {
  const e164Digits = phone.e164.replace(/\D/g, '');
  return `${e164Digits} ${phone.national}`;
}

export interface NewPatient {
  displayNumber: string;
  fullName: string;
  phone: NormalizedPhoneInput;
  dateOfBirth: string | null;
  sex: PatientSex;
  email: string | null;
  address: string | null;
  insurance: string | null;
  emergencyContact: string | null;
  notes: string | null;
  medicalAlerts: string[];
  primaryDentistUserId: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  externalId: string | null;
}

/**
 * Only the fields present are changed. Setting `fullName` or `phone` also rewrites the derived
 * `nameKey`/`phoneSearch` search columns; `undefined` means "leave alone", `null` (where allowed)
 * means "clear".
 */
export interface PatientPatch {
  fullName?: string;
  phone?: NormalizedPhoneInput;
  dateOfBirth?: string | null;
  sex?: PatientSex;
  email?: string | null;
  address?: string | null;
  insurance?: string | null;
  emergencyContact?: string | null;
  notes?: string | null;
  medicalAlerts?: string[];
  primaryDentistUserId?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  externalId?: string | null;
}

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
 * `sort=dentist`/`sort=balance` order by `coalesce(array_position(ids, <column>), restAt)` (design
 * Q7): `column: 'id'` ranks patients directly (billing's balance order), `'primaryDentistUserId'`
 * ranks by the practitioner id each patient is assigned to (dentists ordered by display name,
 * resolved by the caller via `users`). Never exposed over HTTP; internal to `search`.
 */
export interface PatientRank {
  column: 'id' | 'primaryDentistUserId';
  ids: readonly string[];
  restAt: number;
}

export interface PatientSearchOptions {
  page: number;
  size: number;
  sort: PatientSortKey;
  dir: 'asc' | 'desc';
  /** Restricts the result to these ids; an empty array matches nothing (never "all"). */
  idsIn?: readonly string[];
  /** Required when `sort` is `'dentist'` or `'balance'` (see `PatientRank`). */
  rank?: PatientRank;
}

export interface PatientSearchResult {
  rows: DomainPatient[];
  total: number;
}

/** Escapes LIKE/ILIKE metacharacters so user input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * A Postgres `uuid[]` array literal built from parameterised elements. A bare `sql`${ids}` `
 * interpolation of a JS array is *not* an array literal to Postgres — drizzle spreads it as
 * `($1, $2)`, a row/record constructor, which `::uuid[]` cannot cast. `array[$1, $2]::uuid[]` is
 * the correct literal form.
 */
function uuidArrayLiteral(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`array[]::uuid[]`;
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;
}

const MIN_PHONE_QUERY_DIGITS = 2;

/**
 * Patients of the current tenant (RLS). Repositories never accept or filter by `tenantId`
 * (CLAUDE.md §5); `insert`/`update` derive `name_key`/`phone_search` from `fullName`/`phone` so
 * callers can never let them drift.
 */
@Injectable()
export class PatientsRepository {
  constructor(private readonly db: TenantDb) {}

  insert(input: NewPatient): Promise<DomainPatient> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .insert(patients)
        .values({
          id: newId(),
          displayNumber: input.displayNumber,
          fullName: input.fullName,
          nameKey: nameKey(input.fullName),
          phone: input.phone.e164,
          phoneSearch: phoneSearchOf(input.phone),
          dateOfBirth: input.dateOfBirth,
          sex: input.sex,
          email: input.email,
          address: input.address,
          insurance: input.insurance,
          emergencyContact: input.emergencyContact,
          notes: input.notes,
          medicalAlerts: input.medicalAlerts,
          primaryDentistUserId: input.primaryDentistUserId,
          guardianName: input.guardianName,
          guardianPhone: input.guardianPhone,
          externalId: input.externalId,
        })
        .returning();
      if (!row) throw new Error('patient insert returned no row');
      return toDomain(row);
    });
  }

  update(id: string, patch: PatientPatch): Promise<DomainPatient | undefined> {
    const set: Partial<typeof patients.$inferInsert> = {};
    if (patch.fullName !== undefined) {
      set.fullName = patch.fullName;
      set.nameKey = nameKey(patch.fullName);
    }
    if (patch.phone !== undefined) {
      set.phone = patch.phone.e164;
      set.phoneSearch = phoneSearchOf(patch.phone);
    }
    if (patch.dateOfBirth !== undefined) set.dateOfBirth = patch.dateOfBirth;
    if (patch.sex !== undefined) set.sex = patch.sex;
    if (patch.email !== undefined) set.email = patch.email;
    if (patch.address !== undefined) set.address = patch.address;
    if (patch.insurance !== undefined) set.insurance = patch.insurance;
    if (patch.emergencyContact !== undefined) set.emergencyContact = patch.emergencyContact;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.medicalAlerts !== undefined) set.medicalAlerts = patch.medicalAlerts;
    if (patch.primaryDentistUserId !== undefined) {
      set.primaryDentistUserId = patch.primaryDentistUserId;
    }
    if (patch.guardianName !== undefined) set.guardianName = patch.guardianName;
    if (patch.guardianPhone !== undefined) set.guardianPhone = patch.guardianPhone;
    if (patch.externalId !== undefined) set.externalId = patch.externalId;

    return this.db.run(async (tx) => {
      const [row] = await tx.update(patients).set(set).where(eq(patients.id, id)).returning();
      return row ? toDomain(row) : undefined;
    });
  }

  async findById(id: string): Promise<DomainPatient | undefined> {
    const [row] = await this.db.run((tx) => tx.select().from(patients).where(eq(patients.id, id)));
    return row ? toDomain(row) : undefined;
  }

  async findByIds(ids: readonly string[]): Promise<DomainPatient[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(patients)
        .where(inArray(patients.id, [...ids])),
    );
    return rows.map(toDomain);
  }

  /**
   * Locks both rows `FOR UPDATE` in id order (never in `(a, b)` argument order), so two concurrent
   * merges touching an overlapping pair of patients can never deadlock. Throws `PatientNotFoundError`
   * if either id doesn't resolve (e.g. already deleted by a raw admin action).
   */
  async lockPair(a: string, b: string): Promise<{ a: DomainPatient; b: DomainPatient }> {
    const [first, second] = a < b ? [a, b] : [b, a];
    return this.db.run(async (tx) => {
      const rows = await tx
        .select()
        .from(patients)
        .where(inArray(patients.id, [first, second]))
        .orderBy(patients.id)
        .for('update');
      const byId = new Map(rows.map((row) => [row.id, toDomain(row)]));
      const patientA = byId.get(a);
      const patientB = byId.get(b);
      if (!patientA) throw new PatientNotFoundError(`Patient ${a} not found`);
      if (!patientB) throw new PatientNotFoundError(`Patient ${b} not found`);
      return { a: patientA, b: patientB };
    });
  }

  /** Archives (`at` a timestamp) or restores (`at` `null`) every id; returns the ids affected. */
  async setArchived(ids: readonly string[], at: Date | null): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .update(patients)
        .set({ deletedAt: at })
        .where(inArray(patients.id, [...ids]))
        .returning({ id: patients.id }),
    );
    return rows.map((row) => row.id);
  }

  /** Archives the dropped record of a merge with `mergedIntoId` pointing at the kept one. */
  async markMerged(dropId: string, keepId: string, at: Date): Promise<DomainPatient | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(patients)
        .set({ mergedIntoId: keepId, deletedAt: at })
        .where(eq(patients.id, dropId))
        .returning(),
    );
    return row ? toDomain(row) : undefined;
  }

  private whereFor(filters: PatientSearchFilters, idsIn: readonly string[] | undefined): SQL {
    const conditions: SQL[] = [];

    if (filters.view === 'archived') {
      conditions.push(isNotNull(patients.deletedAt));
    } else {
      conditions.push(isNull(patients.deletedAt));
    }

    if (filters.q) {
      const escapedQ = escapeLike(filters.q);
      const qNameKey = escapeLike(nameKey(filters.q));
      const ors: SQL[] = [
        like(patients.nameKey, `%${qNameKey}%`),
        ilike(patients.displayNumber, `%${escapedQ}%`),
        ilike(patients.email, `%${escapedQ}%`),
      ];
      const qDigits = digitsOf(filters.q);
      if (qDigits.length >= MIN_PHONE_QUERY_DIGITS) {
        ors.push(like(patients.phoneSearch, `%${escapeLike(qDigits)}%`));
      }
      const qCondition = or(...ors);
      if (qCondition) conditions.push(qCondition);
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

    if (idsIn) conditions.push(inArray(patients.id, [...idsIn]));

    return and(...conditions) ?? sql`true`;
  }

  /**
   * Orders by the requested sort, always tie-broken by `name_key` then `id` for stable paging.
   * `sort=age`: ascending age (youngest first) means the *most recent* date of birth first, so the
   * date-of-birth direction is inverted relative to `dir`; patients with no date of birth always
   * sort last, in either direction. `sort=recent` ignores `dir` — it always means "most recently
   * updated first" (documented design choice: there is no meaningful "least recently updated"
   * saved view). `sort=dentist`/`'balance'` require `options.rank` (design Q7).
   */
  private orderByFor(options: PatientSearchOptions): SQL[] {
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
        const column =
          options.rank.column === 'primaryDentistUserId'
            ? patients.primaryDentistUserId
            : patients.id;
        return [
          sql`coalesce(array_position(${uuidArrayLiteral(options.rank.ids)}, ${column}), ${options.rank.restAt})`,
          ...tieBreak,
        ];
      }
    }
  }

  async search(
    filters: PatientSearchFilters,
    options: PatientSearchOptions,
  ): Promise<PatientSearchResult> {
    if (options.idsIn && options.idsIn.length === 0) {
      return { rows: [], total: 0 };
    }

    const where = this.whereFor(filters, options.idsIn);
    const orderBy = this.orderByFor(options);

    // Postgres `count()` is `bigint`, which node-postgres returns as a string (not a `number`,
    // which could lose precision) — typed and converted explicitly rather than trusted as `number`.
    const rows = await this.db.run((tx) =>
      tx
        .select({ ...getTableColumns(patients), total: sql<string>`count(*) over ()` })
        .from(patients)
        .where(where)
        .orderBy(...orderBy)
        .limit(options.size)
        .offset((options.page - 1) * options.size),
    );

    const total = Number(rows.at(0)?.total ?? 0);
    return { rows: rows.map((row) => toDomain(row)), total };
  }

  async counts(): Promise<{ active: number; archived: number }> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({
          active: sql<string>`count(*) filter (where ${patients.deletedAt} is null)`,
          archived: sql<string>`count(*) filter (where ${patients.deletedAt} is not null)`,
        })
        .from(patients),
    );
    return { active: Number(row?.active ?? 0), archived: Number(row?.archived ?? 0) };
  }

  /** Active rows with a non-null date of birth whose (name_key, dob) is shared by ≥ 2 rows. */
  async duplicateRows(): Promise<DomainPatient[]> {
    return this.db.run(async (tx) => {
      const dupeGroups = tx
        .select({ nameKey: patients.nameKey, dateOfBirth: patients.dateOfBirth })
        .from(patients)
        .where(and(isNull(patients.deletedAt), isNotNull(patients.dateOfBirth)))
        .groupBy(patients.nameKey, patients.dateOfBirth)
        .having(sql`count(*) >= 2`)
        .as('dupe_groups');

      const rows = await tx
        .select(getTableColumns(patients))
        .from(patients)
        .innerJoin(
          dupeGroups,
          and(
            eq(patients.nameKey, dupeGroups.nameKey),
            eq(patients.dateOfBirth, dupeGroups.dateOfBirth),
          ),
        )
        .where(and(isNull(patients.deletedAt), isNotNull(patients.dateOfBirth)));
      return rows.map((row) => toDomain(row));
    });
  }

  /** Active rows sharing `nameKey`/`dateOfBirth`, the create/edit panel's duplicate check. */
  async findTwins(key: string, dateOfBirth: string, excludeId?: string): Promise<DomainPatient[]> {
    const conditions = [
      isNull(patients.deletedAt),
      eq(patients.nameKey, key),
      eq(patients.dateOfBirth, dateOfBirth),
    ];
    if (excludeId) conditions.push(ne(patients.id, excludeId));
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(patients)
        .where(and(...conditions)),
    );
    return rows.map(toDomain);
  }
}
