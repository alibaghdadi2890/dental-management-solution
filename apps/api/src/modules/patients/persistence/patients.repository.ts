import type { PatientSex } from '@dcm/contracts';
import { phoneDigits } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, eq, getTableColumns, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { newId } from '../../../platform/kernel/id';
import { nameKey } from '../domain/name-key';
import { PatientNotFoundError } from '../domain/patient-errors';
import type { DomainPatient } from '../domain/patient';
import {
  idAmong,
  orderByFor,
  whereFor,
  type PatientSearchFilters,
  type PatientSearchOptions,
} from './patient-search.sql';
import { patients } from './schema';

export type {
  PatientRank,
  PatientSearchFilters,
  PatientSearchOptions,
  PatientSortKey,
  PatientView,
} from './patient-search.sql';

type PatientRow = typeof patients.$inferSelect;

/**
 * `updated_at` on every write comes from the database clock, like the insert's `defaultNow()`,
 * not from the API host's clock (`timestamps()`'s `$onUpdate`): `sort=recent` compares rows
 * stamped by both, and the two clocks can drift apart.
 */
const DB_NOW = sql`now()`;

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
  return `${phoneDigits(phone.e164)} ${phone.national}`;
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
}

export interface PatientSearchResult {
  rows: DomainPatient[];
  total: number;
}

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

    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(patients)
        .set({ ...set, updatedAt: DB_NOW })
        .where(eq(patients.id, id))
        .returning();
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
      tx.select().from(patients).where(idAmong(patients.id, ids)),
    );
    return rows.map(toDomain);
  }

  /**
   * Reads the rows among `ids` `FOR UPDATE`, locked in id order (the order `lockPair` uses, so
   * bulk archive/restore and merges never deadlock each other). A concurrent edit, merge or
   * archive of any of them waits for this transaction, so a before-snapshot taken here is the one
   * the caller's writes apply to. Must run inside an already-open transaction (throws otherwise).
   * Ids invisible under RLS are simply absent.
   */
  async findByIdsForUpdate(ids: readonly string[]): Promise<DomainPatient[]> {
    if (!this.db.currentTransaction()) {
      throw new Error('findByIdsForUpdate must run inside a transaction');
    }
    if (ids.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(patients)
        .where(idAmong(patients.id, ids))
        .orderBy(patients.id)
        .for('update'),
    );
    return rows.map(toDomain);
  }

  /**
   * Reads one row `FOR UPDATE`, so a concurrent merge or edit of the same patient waits for this
   * transaction. Like `lockPair`, it must run inside an already-open transaction (throws
   * otherwise). Undefined when the id doesn't resolve under RLS.
   */
  async findForUpdate(id: string): Promise<DomainPatient | undefined> {
    if (!this.db.currentTransaction()) {
      throw new Error('findForUpdate must run inside a transaction');
    }
    const [row] = await this.db.run((tx) =>
      tx.select().from(patients).where(eq(patients.id, id)).for('update'),
    );
    return row ? toDomain(row) : undefined;
  }

  /**
   * Reads one row `FOR SHARE`: concurrent readers and other share-lockers proceed, but a merge,
   * archive or edit (`FOR UPDATE`) waits until this transaction ends. Must run inside an
   * already-open transaction (throws otherwise). Undefined when the id doesn't resolve under RLS.
   */
  async findForShare(id: string): Promise<DomainPatient | undefined> {
    if (!this.db.currentTransaction()) {
      throw new Error('findForShare must run inside a transaction');
    }
    const [row] = await this.db.run((tx) =>
      tx.select().from(patients).where(eq(patients.id, id)).for('share'),
    );
    return row ? toDomain(row) : undefined;
  }

  /**
   * Locks both rows `FOR UPDATE` in id order (never in `(a, b)` argument order), so two concurrent
   * merges touching an overlapping pair of patients can never deadlock. Must run inside an
   * already-open transaction — `TenantDb.run()` would otherwise open and commit its own, releasing
   * the row lock before the caller (the merge use case) gets to apply its updates in the "same"
   * transaction — so it throws immediately if none is open, rather than silently locking nothing
   * useful. Throws `PatientNotFoundError` if either id doesn't resolve under the caller's RLS view
   * (already deleted, or another tenant's id).
   */
  async lockPair(a: string, b: string): Promise<{ a: DomainPatient; b: DomainPatient }> {
    if (!this.db.currentTransaction()) {
      throw new Error('lockPair must run inside a transaction');
    }
    const [first, second] = a < b ? [a, b] : [b, a];
    return this.db.run(async (tx) => {
      const rows = await tx
        .select()
        .from(patients)
        .where(idAmong(patients.id, [first, second]))
        .orderBy(patients.id)
        .for('update');
      const byId = new Map(rows.map((row) => [row.id, toDomain(row)]));
      const patientA = byId.get(a);
      const patientB = byId.get(b);
      if (!patientA || !patientB) throw new PatientNotFoundError('Patient not found');
      return { a: patientA, b: patientB };
    });
  }

  /**
   * Archives every id currently active (`deleted_at is null`), or restores every id currently
   * archived and not merged away (`deleted_at is not null and merged_into_id is null` — a merged
   * record is never restored directly, design Q11: `patient.merged`). An id already in the target
   * state, already merged (on restore), or invisible under RLS is silently skipped rather than
   * erroring; returns only the rows that were truly changed, as they are after the change.
   */
  async setArchived(ids: readonly string[], at: Date | null): Promise<DomainPatient[]> {
    if (ids.length === 0) return [];
    const condition =
      at === null
        ? and(
            idAmong(patients.id, ids),
            isNotNull(patients.deletedAt),
            isNull(patients.mergedIntoId),
          )
        : and(idAmong(patients.id, ids), isNull(patients.deletedAt));
    const rows = await this.db.run((tx) =>
      tx.update(patients).set({ deletedAt: at, updatedAt: DB_NOW }).where(condition).returning(),
    );
    return rows.map(toDomain);
  }

  /** Archives the dropped record of a merge with `mergedIntoId` pointing at the kept one. */
  async markMerged(dropId: string, keepId: string, at: Date): Promise<DomainPatient | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(patients)
        .set({ mergedIntoId: keepId, deletedAt: at, updatedAt: DB_NOW })
        .where(eq(patients.id, dropId))
        .returning(),
    );
    return row ? toDomain(row) : undefined;
  }

  async search(
    filters: PatientSearchFilters,
    options: PatientSearchOptions,
  ): Promise<PatientSearchResult> {
    if (options.idsIn && options.idsIn.length === 0) {
      return { rows: [], total: 0 };
    }

    const where = whereFor(filters, options.idsIn);
    const orderBy = orderByFor(options);

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

    if (rows.length === 0 && options.page > 1) {
      // `count(*) over ()` is a window over the *returned* rows: an out-of-range page (e.g. the
      // list shrank after the client fetched page 3) returns zero rows and so zero window total,
      // which would misreport `total` as 0 rather than the real count — worth a second query only
      // in this (uncommon) case.
      const total = await this.db.run(async (tx) => {
        const [row] = await tx
          .select({ total: sql<string>`count(*)` })
          .from(patients)
          .where(where);
        return Number(row?.total ?? 0);
      });
      return { rows: [], total };
    }

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

  /**
   * The distinct dentists assigned to any patient, archived ones included — `sort=dentist` ranks
   * by these, so a patient whose dentist has since been deactivated still sorts under that name.
   */
  async assignedDentistIds(): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .selectDistinct({ id: patients.primaryDentistUserId })
        .from(patients)
        .where(isNotNull(patients.primaryDentistUserId)),
    );
    return rows.flatMap((row) => (row.id === null ? [] : [row.id]));
  }

  /** Active rows sharing a name (matched via `nameKey`) and date of birth — the duplicate check. */
  async findTwins(
    fullName: string,
    dateOfBirth: string,
    excludeId?: string,
  ): Promise<DomainPatient[]> {
    const conditions = [
      isNull(patients.deletedAt),
      eq(patients.nameKey, nameKey(fullName)),
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
