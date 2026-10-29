import type { ChargeUnit, Jaw } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, isNotNull, isNull } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { RecordNotFoundError } from '../domain/visit-errors';
import { patientDiagnoses, visits } from './schema';

type DiagnosisRow = typeof patientDiagnoses.$inferSelect;

/** A `patient_diagnoses` row as the application sees it (RLS supplies the tenant). */
export type StoredDiagnosisRecord = Omit<DiagnosisRow, 'tenantId'>;

export type NewDiagnosisRecord = Pick<
  StoredDiagnosisRecord,
  | 'patientId'
  | 'level'
  | 'toothCode'
  | 'jaw'
  | 'surfaces'
  | 'diagnosisId'
  | 'code'
  | 'name'
  | 'category'
  | 'note'
  | 'seenOn'
  | 'seenOnFileId'
  | 'dentistId'
  | 'recordedBy'
  | 'recordedInVisitId'
  | 'recordedAt'
>;

/** A record with the local date of the visit that recorded it; null when none did (ADR-0031):
 * the service then dates it by `recordedAt` in the tenant's time zone. */
export interface DatedDiagnosisRecord {
  record: StoredDiagnosisRecord;
  visitDate: string | null;
}

/** Resolve, reopen (the pair is set or cleared together), what it was seen on (the pair too),
 * or the soft delete. */
export type DiagnosisRecordPatch = Partial<
  Pick<
    StoredDiagnosisRecord,
    'status' | 'resolvedInVisitId' | 'resolvedAt' | 'seenOn' | 'seenOnFileId' | 'deletedAt'
  >
>;

function toStored({ tenantId: _tenantId, ...record }: DiagnosisRow): StoredDiagnosisRecord {
  return record;
}

const { tenantId: _tenantId, ...diagnosisColumns } = getTableColumns(patientDiagnoses);

/**
 * Diagnoses recorded on the tenant's patients (RLS through `TenantDb`). Every lookup names the
 * patient too: a visit reaches only its own patient's records, and the queries use the
 * `(tenant_id, patient_id, tooth_code)` index.
 */
/** Where a diagnosis is: a tooth (`per_tooth`), a jaw (`per_jaw`) or the whole mouth. */
export interface DiagnosisPlace {
  level: ChargeUnit;
  toothCode: string | null;
  jaw: Jaw | null;
}

@Injectable()
export class PatientDiagnosesRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(record: NewDiagnosisRecord): Promise<StoredDiagnosisRecord> {
    const [row] = await this.db.run((tx) => tx.insert(patientDiagnoses).values(record).returning());
    if (!row) throw new Error('diagnosis record insert returned no row');
    return toStored(row);
  }

  /**
   * The patient's diagnosis (not removed) `FOR UPDATE` in the caller's transaction, with the local
   * date of the visit that recorded it, if one did; else 404 `record.not_found`.
   */
  lockForPatient(id: string, patientId: string): Promise<DatedDiagnosisRecord> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select({ ...diagnosisColumns, visitDate: visits.localDate })
        .from(patientDiagnoses)
        .leftJoin(visits, eq(visits.id, patientDiagnoses.recordedInVisitId))
        .where(
          and(
            eq(patientDiagnoses.id, id),
            eq(patientDiagnoses.patientId, patientId),
            isNull(patientDiagnoses.deletedAt),
          ),
        )
        .for('update', { of: patientDiagnoses });
      if (!row) throw new RecordNotFoundError('Diagnosis not found for this patient');
      const { visitDate, ...record } = row;
      return { record, visitDate };
    });
  }

  /**
   * The patient's diagnoses that aren't removed, active and resolved, in the order they were
   * recorded, each with the local date of the visit that recorded it, if one did; only one tooth's when
   * `toothCode` is given.
   */
  listForPatient(patientId: string, toothCode?: string): Promise<DatedDiagnosisRecord[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ ...diagnosisColumns, visitDate: visits.localDate })
        .from(patientDiagnoses)
        .leftJoin(visits, eq(visits.id, patientDiagnoses.recordedInVisitId))
        .where(
          and(
            eq(patientDiagnoses.patientId, patientId),
            toothCode === undefined ? undefined : eq(patientDiagnoses.toothCode, toothCode),
            isNull(patientDiagnoses.deletedAt),
          ),
        )
        .orderBy(asc(patientDiagnoses.recordedAt), asc(patientDiagnoses.id));
      return rows.map(({ visitDate, ...record }) => ({ record, visitDate }));
    });
  }

  async update(id: string, patch: DiagnosisRecordPatch): Promise<StoredDiagnosisRecord> {
    const [row] = await this.db.run((tx) =>
      tx.update(patientDiagnoses).set(patch).where(eq(patientDiagnoses.id, id)).returning(),
    );
    if (!row) throw new RecordNotFoundError('Diagnosis not found');
    return toStored(row);
  }

  /**
   * The merge re-point (V10): every diagnosis record of `droppedId`, removed ones included, moves
   * to `keptId`. Returns how many moved.
   */
  async repointPatient(droppedId: string, keptId: string): Promise<number> {
    const rows = await this.db.run((tx) =>
      tx
        .update(patientDiagnoses)
        .set({ patientId: keptId })
        .where(eq(patientDiagnoses.patientId, droppedId))
        .returning({ id: patientDiagnoses.id }),
    );
    return rows.length;
  }

  /**
   * The patient's diagnoses that were seen on a file (ADR-0049), resolved ones included, in the
   * order recorded: the image viewer's "diagnoses that cite this image".
   */
  citingFiles(patientId: string): Promise<StoredDiagnosisRecord[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(patientDiagnoses)
          .where(
            and(
              eq(patientDiagnoses.patientId, patientId),
              isNotNull(patientDiagnoses.seenOnFileId),
              isNull(patientDiagnoses.deletedAt),
            ),
          )
          .orderBy(asc(patientDiagnoses.recordedAt), asc(patientDiagnoses.id))
      ).map(toStored),
    );
  }

  /**
   * The id of the most recently recorded active diagnosis at this place — the tooth, the jaw, or
   * the whole mouth (spec §drawer, ADR-0064) — or null.
   */
  async latestActiveAt(patientId: string, place: DiagnosisPlace): Promise<string | null> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ id: patientDiagnoses.id })
        .from(patientDiagnoses)
        .where(
          and(
            eq(patientDiagnoses.patientId, patientId),
            eq(patientDiagnoses.level, place.level),
            place.toothCode === null ? undefined : eq(patientDiagnoses.toothCode, place.toothCode),
            place.jaw === null ? undefined : eq(patientDiagnoses.jaw, place.jaw),
            eq(patientDiagnoses.status, 'active'),
            isNull(patientDiagnoses.deletedAt),
          ),
        )
        .orderBy(desc(patientDiagnoses.recordedAt), desc(patientDiagnoses.id))
        .limit(1),
    );
    return row?.id ?? null;
  }
}
