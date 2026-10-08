import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { files } from './schema';

type FileRow = typeof files.$inferSelect;

/** A `files` row as the application sees it (RLS supplies the tenant). */
export type StoredFile = Omit<FileRow, 'tenantId'>;

export type NewPendingFile = Pick<
  StoredFile,
  | 'id'
  | 'patientId'
  | 'kind'
  | 'originalFilename'
  | 'sizeBytes'
  | 'mimeType'
  | 'storageKey'
  | 'hasPreview'
  | 'uploadedBy'
>;

export type FilePatchRow = Partial<
  Pick<
    StoredFile,
    | 'visitId'
    | 'toothCode'
    | 'category'
    | 'subCategory'
    | 'takenAt'
    | 'note'
    | 'sizeBytes'
    | 'orientation'
    | 'savedAt'
    | 'archivedAt'
    | 'archivedBy'
    | 'archiveReason'
  >
>;

function toStored({ tenantId: _tenantId, ...row }: FileRow): StoredFile {
  return row;
}

/** How many of a patient's files one read returns (spec D8). */
export const PATIENT_FILES_LIMIT = 1000;

const saved = isNotNull(files.savedAt);
const pending = isNull(files.savedAt);

/** The tenant's files (feature 8; RLS). Pending rows are uploads that were not saved yet. */
@Injectable()
export class FilesRepository {
  constructor(private readonly db: TenantDb) {}

  async insertPending(file: NewPendingFile): Promise<StoredFile> {
    const [row] = await this.db.run((tx) => tx.insert(files).values(file).returning());
    if (!row) throw new Error('file insert returned no row');
    return toStored(row);
  }

  /** `uploadedBy`'s pending uploads among `ids`, locked when a transaction is open. */
  pendingOf(uploadedBy: string, ids: readonly string[]): Promise<StoredFile[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(files)
          .where(and(inArray(files.id, [...ids]), eq(files.uploadedBy, uploadedBy), pending))
          .orderBy(asc(files.id))
          .for('update')
      ).map(toStored),
    );
  }

  async deletePending(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.run((tx) => tx.delete(files).where(and(inArray(files.id, [...ids]), pending)));
  }

  /** A patient's files, archived ones included, the most recently taken first. */
  listForPatient(patientId: string): Promise<StoredFile[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(files)
          .where(and(eq(files.patientId, patientId), saved))
          .orderBy(desc(files.takenAt), desc(files.id))
          .limit(PATIENT_FILES_LIMIT)
      ).map(toStored),
    );
  }

  async findSaved(id: string): Promise<StoredFile | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(files)
        .where(and(eq(files.id, id), saved)),
    );
    return row && toStored(row);
  }

  /** The saved files among `ids`, locked `FOR UPDATE` in id order. */
  lockSaved(ids: readonly string[]): Promise<StoredFile[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(files)
          .where(and(inArray(files.id, [...ids]), saved))
          .orderBy(asc(files.id))
          .for('update')
      ).map(toStored),
    );
  }

  async update(id: string, patch: FilePatchRow): Promise<StoredFile> {
    const [row] = await this.db.run((tx) =>
      tx.update(files).set(patch).where(eq(files.id, id)).returning(),
    );
    if (!row) throw new Error('file update returned no row');
    return toStored(row);
  }

  /** The merge re-point: every row of the dropped patient, pending and archived ones too. */
  async repointPatient(fromPatientId: string, toPatientId: string): Promise<number> {
    const rows = await this.db.run((tx) =>
      tx
        .update(files)
        .set({ patientId: toPatientId })
        .where(eq(files.patientId, fromPatientId))
        .returning({ id: files.id }),
    );
    return rows.length;
  }
}
