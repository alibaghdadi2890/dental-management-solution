import type { MedicalOption, MedicalOptionKind } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { newId } from '../../../platform/kernel/id';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { medicalHistoryOptions, patientMedicalItems } from './schema';

type OptionRow = typeof medicalHistoryOptions.$inferSelect;

const toOption = ({ id, kind, name, active }: OptionRow): MedicalOption => ({
  id,
  kind,
  name,
  active,
});

const live = isNull(medicalHistoryOptions.deletedAt);

/** A concurrent save took the name between the batch's own check and the write. */
function rethrowNameRace(error: unknown): never {
  if (isUniqueViolation(error, 'medical_history_options_name_unique')) {
    const message = 'A name in this batch is already in its list';
    throw new ValidationFailedError(message, [{ path: 'items', code: 'duplicate', message }]);
  }
  throw error;
}

/** A clinic's allergy and condition lists (RLS through `TenantDb`). */
@Injectable()
export class MedicalOptionsRepository {
  constructor(private readonly db: TenantDb) {}

  /** Live rows: allergies then conditions, each by name. */
  list(): Promise<MedicalOption[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(medicalHistoryOptions)
          .where(live)
          .orderBy(
            asc(medicalHistoryOptions.kind),
            asc(sql`lower(${medicalHistoryOptions.name})`),
            asc(medicalHistoryOptions.id),
          )
      ).map(toOption),
    );
  }

  /** The live rows among `ids`; unknown ids are absent. */
  async findByIds(ids: readonly string[]): Promise<MedicalOption[]> {
    if (ids.length === 0) return [];
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(medicalHistoryOptions)
          .where(and(inArray(medicalHistoryOptions.id, [...ids]), live))
      ).map(toOption),
    );
  }

  /**
   * The live rows among `ids`, locked `FOR SHARE` in id order until the transaction ends: a
   * history that picks them and a delete of one (`lock`) serialise, whichever comes first.
   */
  async shareByIds(ids: readonly string[]): Promise<MedicalOption[]> {
    if (ids.length === 0) return [];
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(medicalHistoryOptions)
          .where(and(inArray(medicalHistoryOptions.id, [...ids]), live))
          .orderBy(medicalHistoryOptions.id)
          .for('share')
      ).map(toOption),
    );
  }

  /** The live row of a list with this name, whatever its case. */
  async findByName(kind: MedicalOptionKind, name: string): Promise<MedicalOption | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(medicalHistoryOptions)
        .where(
          and(
            eq(medicalHistoryOptions.kind, kind),
            eq(sql`lower(${medicalHistoryOptions.name})`, name.toLowerCase()),
            live,
          ),
        ),
    );
    return row && toOption(row);
  }

  /** A live row locked `FOR UPDATE`, so its delete and a history that picks it serialise. */
  async lock(id: string): Promise<MedicalOption | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(medicalHistoryOptions)
        .where(and(eq(medicalHistoryOptions.id, id), live))
        .for('update'),
    );
    return row && toOption(row);
  }

  async countLive(): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx.select({ total: count() }).from(medicalHistoryOptions).where(live),
    );
    return row?.total ?? 0;
  }

  async insert(option: Omit<MedicalOption, 'id'>): Promise<MedicalOption> {
    try {
      const [row] = await this.db.run((tx) =>
        tx
          .insert(medicalHistoryOptions)
          .values({ id: newId(), ...option })
          .returning(),
      );
      if (!row) throw new Error('medical option insert returned no row');
      return toOption(row);
    } catch (error) {
      rethrowNameRace(error);
    }
  }

  /** Inserts the names that are free in their list; returns the rows inserted. */
  insertIfAbsent(kind: MedicalOptionKind, names: readonly string[]): Promise<MedicalOption[]> {
    if (names.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .insert(medicalHistoryOptions)
          .values(names.map((name) => ({ id: newId(), kind, name })))
          .onConflictDoNothing()
          .returning()
      ).map(toOption),
    );
  }

  async update(
    id: string,
    patch: Partial<Pick<MedicalOption, 'name' | 'active'>>,
  ): Promise<MedicalOption> {
    try {
      const [row] = await this.db.run((tx) =>
        tx
          .update(medicalHistoryOptions)
          .set(patch)
          .where(and(eq(medicalHistoryOptions.id, id), live))
          .returning(),
      );
      if (!row) throw new Error(`medical option ${id} disappeared under its lock`);
      return toOption(row);
    } catch (error) {
      rethrowNameRace(error);
    }
  }

  async softDelete(id: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(medicalHistoryOptions)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(medicalHistoryOptions.id, id), live)),
    );
  }

  /** A patient's history has the option: it can only be deactivated. */
  async isInUse(id: string): Promise<boolean> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ optionId: patientMedicalItems.optionId })
        .from(patientMedicalItems)
        .where(eq(patientMedicalItems.optionId, id))
        .limit(1),
    );
    return row !== undefined;
  }
}
