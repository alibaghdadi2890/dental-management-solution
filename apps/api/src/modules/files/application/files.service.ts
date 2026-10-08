import {
  type ArchiveFilesInput,
  canArchiveFile,
  canRestoreFile,
  classifyUpload,
  type FileActor,
  fileCategorySchema,
  type FileDownload,
  fileKindSchema,
  fileOrientationSchema,
  fileSubCategorySchema,
  MAX_FILE_BYTES,
  type PatientFile,
  type PatientFiles,
  type RestoreFilesInput,
  type SaveFilesInput,
  toothCodeSchema,
  type UpdateFilesInput,
  type UploadIntent,
  type UploadTarget,
} from '@dcm/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { newId } from '../../../platform/kernel/id';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { ObjectStorage } from '../../../platform/storage/object-storage';
import { AuditService } from '../../audit';
import { type VisitRef, VisitsService } from '../../clinical';
import { PatientsService } from '../../patients';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { changesOf } from '../domain/file-changes';
import {
  FileArchiveForbiddenError,
  FileNotFoundError,
  FileTooLargeError,
  FileTypeUnsupportedError,
  FileUploadIncompleteError,
  FileVisitMismatchError,
} from '../domain/file-errors';
import { deriveTakenAt, isAfterToday } from '../domain/taken-at';
import {
  FILE_ARCHIVED,
  FILE_RESTORED,
  FILE_UPDATED,
  FILE_UPLOADED,
  type FileArchived,
  type FileRestored,
  type FileUpdated,
  type FileUploaded,
} from '../events/file-events';
import { FilesRepository, type StoredFile } from '../persistence/files.repository';

const FILE = 'file';
const ORIGINAL = 'original';
const DISPLAY = 'display.jpg';
const THUMBNAIL = 'thumb.jpg';
const PREVIEW_TYPE = 'image/jpeg';

/** A browser on a slow line still has to finish a 25 MB upload inside this. */
const UPLOAD_URL_SECONDS = 15 * 60;
/** Thumbnails and display copies: long enough for a viewing session, short enough to expire. */
const VIEW_URL_SECONDS = 15 * 60;
const DOWNLOAD_URL_SECONDS = 60;

/** A saved file: the columns Save fills are no longer nullable. */
type SavedFile = StoredFile & { category: string; takenAt: Date; savedAt: Date };

function assertSaved(file: StoredFile): asserts file is SavedFile {
  if (file.category === null || file.takenAt === null || file.savedAt === null) {
    throw new Error(`file ${file.id} is not saved`);
  }
}

/** The key of a preview object, beside the original. */
function siblingKey(storageKey: string, name: string): string {
  return `${storageKey.slice(0, storageKey.lastIndexOf('/'))}/${name}`;
}

/** What an audit row says a file is, so the Activity screen can write a sentence about it. */
function described(file: StoredFile) {
  return {
    patientId: file.patientId,
    visitId: file.visitId,
    kind: file.kind,
    category: file.category,
    subCategory: file.subCategory,
    toothCode: file.toothCode,
    originalFilename: file.originalFilename,
  };
}

/**
 * A patient's images and documents (feature 8; docs/modules/files.md, ADR-0038 to ADR-0040).
 *
 * The bytes never pass through the API: `requestUpload` records a pending row and answers with
 * signed upload URLs, the browser uploads the original and the previews it made, and `save` turns
 * the pending rows of a batch into files with their category, links and "taken on". Reads answer
 * with short-lived signed URLs. Every mutation re-checks its permission, runs in one `TenantDb`
 * transaction and is audited; the only object-storage calls made around a mutation — the size
 * check before Save, the delete after a discard — run outside the transaction (ADR-0039).
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    private readonly visits: VisitsService,
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    private readonly storage: ObjectStorage,
    private readonly files: FilesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Upload ---

  /**
   * One file about to be uploaded (F1, F2): refused unless it is an accepted type (422
   * `file.type_unsupported`), on a patient that exists and was
   * not merged away. Answers with where to `PUT` the original and, when the browser made
   * previews of an image, the display copy and the thumbnail.
   */
  async requestUpload(input: UploadIntent): Promise<UploadTarget> {
    this.context.requirePermission('file:write');
    const uploadedBy = this.context.requireUserId();
    const upload = classifyUpload(input.filename, input.mimeType);
    if (!upload.accepted) {
      throw new FileTypeUnsupportedError(
        upload.reason === 'dicom' ? 'DICOM files are not supported' : 'File type not supported',
      );
    }
    const id = newId();
    const storageKey = this.storage.tenantKey('files', id, ORIGINAL);
    const hasPreview = input.preview && upload.kind === 'image';
    await this.tenantDb.run(async () => {
      const patient = await this.patients.lockForDependentWrite(input.patientId);
      await this.files.insertPending({
        id,
        patientId: patient.id,
        kind: upload.kind,
        originalFilename: input.filename,
        sizeBytes: input.sizeBytes,
        mimeType: upload.mimeType,
        storageKey,
        hasPreview,
        uploadedBy,
      });
    });
    const sign = (key: string, contentType: string) =>
      this.storage.presignUpload({ key, contentType, expiresInSeconds: UPLOAD_URL_SECONDS });
    const [uploadUrl, displayUploadUrl, thumbnailUploadUrl] = await Promise.all([
      sign(storageKey, upload.mimeType),
      hasPreview ? sign(siblingKey(storageKey, DISPLAY), PREVIEW_TYPE) : null,
      hasPreview ? sign(siblingKey(storageKey, THUMBNAIL), PREVIEW_TYPE) : null,
    ]);
    return { id, mimeType: upload.mimeType, uploadUrl, displayUploadUrl, thumbnailUploadUrl };
  }

  /**
   * Throws away the caller's pending uploads among `ids` (F2: a closed panel, a removed tile);
   * ids that are not theirs, or already saved, are ignored. The objects are deleted after the
   * commit, best effort: a failure leaves bytes no row points to, never a row without bytes.
   */
  async discardUploads(ids: readonly string[]): Promise<void> {
    this.context.requirePermission('file:write');
    const uploadedBy = this.context.requireUserId();
    const discarded = await this.tenantDb.run(async () => {
      const pending = await this.files.pendingOf(uploadedBy, [...new Set(ids)]);
      await this.files.deletePending(pending.map((file) => file.id));
      return pending;
    });
    const keys = discarded.flatMap((file) => this.keysOf(file));
    if (keys.length === 0) return;
    try {
      await this.storage.remove(keys);
    } catch (error) {
      this.logger.warn(
        { err: error, fileIds: discarded.map((file) => file.id) },
        'orphaned upload',
      );
    }
  }

  /**
   * The Save of an upload batch (F2–F5): the caller's pending uploads for this patient become
   * files, each with its category, optional type, tooth, visit and note, and its "taken on"
   * (`deriveTakenAt`). All or nothing. An id that is not one of the caller's pending uploads for
   * the patient → 404 `file.not_found`; bytes not there yet → 409 `file.upload_incomplete`; a
   * stored object over the limit → 422 `file.too_large`; a visit that is not the patient's → 422
   * `file.visit_mismatch`. Audited `file.upload` per file; `FileUploaded`.
   */
  async save(input: SaveFilesInput): Promise<PatientFiles> {
    this.context.requirePermission('file:write');
    const uploadedBy = this.context.requireUserId();
    const ids = input.files.map((file) => file.id);
    if (new Set(ids).size !== ids.length) {
      const message = 'A file is listed twice';
      throw new ValidationFailedError(message, [{ path: 'files', code: 'duplicate', message }]);
    }

    // The bytes first, outside the transaction (ADR-0039).
    const uploaded = await this.files.pendingOf(uploadedBy, ids);
    if (uploaded.length !== ids.length) throw new FileNotFoundError('Upload not found');
    const sizes = new Map<string, number>();
    await Promise.all(
      uploaded.map(async (file) => {
        const object = await this.storage.head(file.storageKey);
        if (!object) throw new FileUploadIncompleteError('This file has not finished uploading');
        if (object.sizeBytes > MAX_FILE_BYTES) throw new FileTooLargeError('File is too large');
        sizes.set(file.id, object.sizeBytes);
      }),
    );

    const saved = await this.tenantDb.run(async () => {
      const patient = await this.patients.lockForDependentWrite(input.patientId);
      const pending = new Map(
        (await this.files.pendingOf(uploadedBy, ids))
          .filter((file) => file.patientId === patient.id)
          .map((file) => [file.id, file]),
      );
      if (pending.size !== ids.length) throw new FileNotFoundError('Upload not found');
      const visits = await this.visitsOf(
        input.files.map((file) => file.visitId),
        patient.id,
      );
      const { timeZone } = await this.tenancy.currentTenant();
      const now = this.clock.now();
      return this.audit.about({ patientId: patient.id }, async () => {
        const rows: StoredFile[] = [];
        for (const item of input.files) {
          const visit = item.visitId ? visits.get(item.visitId) : undefined;
          const row = await this.files.update(item.id, {
            category: item.category,
            subCategory: item.subCategory ?? null,
            toothCode: item.toothCode ?? null,
            visitId: visit?.visitId ?? null,
            note: item.note ?? '',
            takenAt: deriveTakenAt({
              exifTakenAt: item.exifTakenAt,
              visitStartedAt: visit?.startedAt ?? null,
              now,
              timeZone,
            }),
            sizeBytes: sizes.get(item.id) ?? pending.get(item.id)?.sizeBytes ?? 0,
            savedAt: now,
          });
          await this.audit.record({
            action: `${FILE}.upload`,
            resourceType: FILE,
            resourceId: row.id,
            after: { ...described(row), takenAt: row.takenAt, note: row.note },
          });
          const event: FileUploaded = this.events.create(FILE_UPLOADED, this.factsOf(row));
          await this.events.publish(event);
          rows.push(row);
        }
        return rows;
      });
    });
    return { items: await this.present(saved) };
  }

  // --- Read ---

  /**
   * Every saved file of a patient, archived ones included, the most recently taken first
   * (spec D8; at most `PATIENT_FILES_LIMIT`). An unknown patient has none.
   */
  async list(patientId: string): Promise<PatientFiles> {
    this.context.requirePermission('file:read');
    return { items: await this.present(await this.files.listForPatient(patientId)) };
  }

  /** A short-lived URL that saves the original, untouched, under its original filename (F8). */
  async download(id: string): Promise<FileDownload> {
    this.context.requirePermission('file:read');
    const file = await this.files.findSaved(id);
    if (!file) throw new FileNotFoundError('File not found');
    const url = await this.storage.presignDownload({
      key: file.storageKey,
      contentType: file.mimeType,
      disposition: { type: 'attachment', filename: file.originalFilename },
      expiresInSeconds: DOWNLOAD_URL_SECONDS,
    });
    return { url };
  }

  // --- Change ---

  /**
   * Edits one or several files (F3, F7–F9; the viewer's fields, the bulk bar): category, type,
   * tooth, visit, "taken on", note, stored orientation. An unknown id → 404 `file.not_found`; a
   * "taken on" after the clinic's today → 422 `validation_failed` (`patch.takenAt`); a visit that
   * is not the file's patient's → 422 `file.visit_mismatch`. A file the patch does not change is
   * neither written nor audited. Audited `file.update` (before → after of what changed);
   * `FileUpdated`. Answers with every file asked for, as it now is.
   */
  async update(input: UpdateFilesInput): Promise<PatientFiles> {
    this.context.requirePermission('file:write');
    const { patch } = input;
    const rows = await this.tenantDb.run(async () => {
      const files = await this.lockAll(input.ids);
      if (patch.takenAt !== undefined) {
        const { timeZone } = await this.tenancy.currentTenant();
        if (isAfterToday(new Date(patch.takenAt), this.clock.now(), timeZone)) {
          const message = 'Date cannot be in the future';
          throw new ValidationFailedError(message, [
            { path: 'patch.takenAt', code: 'future_date', message },
          ]);
        }
      }
      const visit = patch.visitId ? (await this.visits.refsFor([patch.visitId]))[0] : undefined;
      const result: StoredFile[] = [];
      for (const before of files) {
        const change = changesOf(
          { ...before, category: fileCategorySchema.parse(before.category) },
          patch,
        );
        if (Object.keys(change).length === 0) {
          result.push(before);
          continue;
        }
        if (change.visitId && visit?.patientId !== before.patientId) {
          throw new FileVisitMismatchError("This visit is not one of the patient's visits");
        }
        const after = await this.files.update(before.id, change);
        const changed = Object.keys(change) as (keyof typeof change)[];
        const pick = (file: StoredFile) =>
          Object.fromEntries(changed.map((field) => [field, file[field]]));
        await this.audit.record({
          action: `${FILE}.update`,
          resourceType: FILE,
          resourceId: after.id,
          // Who and what the file is on both sides, so the row reads without a lookup.
          before: { ...described(before), ...pick(before) },
          after: { ...described(after), ...pick(after) },
        });
        const event: FileUpdated = this.events.create(FILE_UPDATED, {
          ...this.factsOf(after),
          fields: changed,
        });
        await this.events.publish(event);
        result.push(after);
      }
      return result;
    });
    return { items: await this.present(rows) };
  }

  /**
   * Archives files (F10): hidden by default, never deleted. Each needs `file:archive`, or to be
   * the caller's own upload of the last 24 hours (F13, `canArchiveFile`), else 403
   * `file.archive_forbidden` for the whole request. Already archived → left as it is. The
   * optional reason is audited (`file.archive`); `FileArchived`.
   */
  async archive(input: ArchiveFilesInput): Promise<PatientFiles> {
    this.context.requirePermission('file:write');
    const actor = this.actor();
    const rows = await this.tenantDb.run(async () => {
      const files = await this.lockAll(input.ids);
      const now = this.clock.now();
      const result: StoredFile[] = [];
      for (const before of files) {
        if (before.archivedAt !== null) {
          result.push(before);
          continue;
        }
        const uploaded = {
          uploadedBy: before.uploadedBy,
          uploadedAt: before.savedAt.toISOString(),
        };
        if (!canArchiveFile(actor, uploaded, now)) {
          throw new FileArchiveForbiddenError('Only a dentist or the owner can archive this file');
        }
        const after = await this.files.update(before.id, {
          archivedAt: now,
          archivedBy: actor.userId,
          archiveReason: input.reason ?? null,
        });
        await this.audit.record({
          action: `${FILE}.archive`,
          resourceType: FILE,
          resourceId: after.id,
          before: { ...described(before), archivedAt: null },
          after: { ...described(after), archivedAt: after.archivedAt },
          reason: input.reason,
        });
        const event: FileArchived = this.events.create(FILE_ARCHIVED, this.factsOf(after));
        await this.events.publish(event);
        result.push(after);
      }
      return result;
    });
    return { items: await this.present(rows) };
  }

  /**
   * Brings archived files back (F10): `file:archive`, or whoever archived the file — the Undo of
   * one's own archive (`canRestoreFile`) — else 403 `file.archive_forbidden`. Not archived → left
   * as it is. Audited `file.restore`; `FileRestored`.
   */
  async restore(input: RestoreFilesInput): Promise<PatientFiles> {
    this.context.requirePermission('file:write');
    const actor = this.actor();
    const rows = await this.tenantDb.run(async () => {
      const files = await this.lockAll(input.ids);
      const result: StoredFile[] = [];
      for (const before of files) {
        if (before.archivedAt === null) {
          result.push(before);
          continue;
        }
        if (!canRestoreFile(actor, before)) {
          throw new FileArchiveForbiddenError('Only a dentist or the owner can restore this file');
        }
        const after = await this.files.update(before.id, {
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
        });
        await this.audit.record({
          action: `${FILE}.restore`,
          resourceType: FILE,
          resourceId: after.id,
          before: { ...described(before), archivedAt: before.archivedAt },
          after: { ...described(after), archivedAt: null },
        });
        const event: FileRestored = this.events.create(FILE_RESTORED, this.factsOf(after));
        await this.events.publish(event);
        result.push(after);
      }
      return result;
    });
    return { items: await this.present(rows) };
  }

  // --- Shared rules ---

  private actor(): FileActor {
    return {
      userId: this.context.requireUserId(),
      can: (permission) => this.context.hasPermission(permission),
    };
  }

  /** Every file among `ids`, saved and locked; one missing → 404 `file.not_found`. */
  private async lockAll(ids: readonly string[]): Promise<SavedFile[]> {
    const wanted = [...new Set(ids)];
    const files = await this.files.lockSaved(wanted);
    if (files.length !== wanted.length) throw new FileNotFoundError('File not found');
    return files.map((file) => {
      assertSaved(file);
      return file;
    });
  }

  /** The visits a batch links to, each one of the patient's (D15). */
  private async visitsOf(
    visitIds: readonly (string | null | undefined)[],
    patientId: string,
  ): Promise<Map<string, VisitRef>> {
    const wanted = [...new Set(visitIds.filter((id): id is string => typeof id === 'string'))];
    if (wanted.length === 0) return new Map();
    const refs = new Map((await this.visits.refsFor(wanted)).map((ref) => [ref.visitId, ref]));
    for (const id of wanted) {
      if (refs.get(id)?.patientId !== patientId) {
        throw new FileVisitMismatchError("This visit is not one of the patient's visits");
      }
    }
    return refs;
  }

  private keysOf(file: StoredFile): string[] {
    return file.hasPreview
      ? [
          file.storageKey,
          siblingKey(file.storageKey, DISPLAY),
          siblingKey(file.storageKey, THUMBNAIL),
        ]
      : [file.storageKey];
  }

  private factsOf(file: StoredFile) {
    return {
      fileId: file.id,
      patientId: file.patientId,
      visitId: file.visitId,
      toothCode: file.toothCode,
      category: fileCategorySchema.parse(file.category),
    };
  }

  /**
   * Rows as the API answers them: staff names, each file's visit (with `visit:read`; a file
   * whose visit was discarded since has none), signed
   * URLs for the thumbnail and the copy the viewer shows (F14), and the storage location for
   * owners and platform admins only (`tenant:write`).
   */
  private async present(rows: readonly StoredFile[]): Promise<PatientFile[]> {
    if (rows.length === 0) return [];
    const names = await this.users.namesByUserIds(
      rows.flatMap((row) => (row.archivedBy ? [row.uploadedBy, row.archivedBy] : [row.uploadedBy])),
    );
    const visitIds = rows.flatMap((row) => (row.visitId ? [row.visitId] : []));
    const readsVisits = this.context.hasPermission('visit:read');
    const visits = new Map(
      (visitIds.length > 0 && readsVisits ? await this.visits.refsFor(visitIds) : []).map((ref) => [
        ref.visitId,
        ref,
      ]),
    );
    const showLocation = this.context.hasPermission('tenant:write');
    const view = (key: string, contentType: string, filename: string) =>
      this.storage.presignDownload({
        key,
        contentType,
        disposition: { type: 'inline', filename },
        expiresInSeconds: VIEW_URL_SECONDS,
      });

    return Promise.all(
      rows.map(async (row): Promise<PatientFile> => {
        assertSaved(row);
        const kind = fileKindSchema.parse(row.kind);
        const visit = row.visitId ? visits.get(row.visitId) : undefined;
        const [thumbnailUrl, viewUrl] = await Promise.all([
          row.hasPreview
            ? view(siblingKey(row.storageKey, THUMBNAIL), PREVIEW_TYPE, THUMBNAIL)
            : null,
          row.hasPreview
            ? view(siblingKey(row.storageKey, DISPLAY), PREVIEW_TYPE, DISPLAY)
            : kind === 'document'
              ? view(row.storageKey, row.mimeType, row.originalFilename)
              : null,
        ]);
        return {
          id: row.id,
          patientId: row.patientId,
          kind,
          category: fileCategorySchema.parse(row.category),
          subCategory: fileSubCategorySchema.nullable().parse(row.subCategory),
          toothCode: toothCodeSchema.nullable().parse(row.toothCode),
          visit: visit
            ? {
                id: visit.visitId,
                displayNumber: visit.displayNumber,
                localDate: visit.localDate,
                status: visit.status,
              }
            : null,
          // A visit discarded since (ADR-0038) reads as no visit at all.
          visitId: readsVisits && !visit ? null : row.visitId,
          takenAt: row.takenAt.toISOString(),
          note: row.note,
          originalFilename: row.originalFilename,
          sizeBytes: row.sizeBytes,
          mimeType: row.mimeType,
          orientation: fileOrientationSchema.parse(row.orientation),
          uploadedBy: row.uploadedBy,
          uploadedByName: names.get(row.uploadedBy) ?? null,
          uploadedAt: row.savedAt.toISOString(),
          archivedAt: row.archivedAt?.toISOString() ?? null,
          archivedBy: row.archivedBy,
          archivedByName: row.archivedBy ? (names.get(row.archivedBy) ?? null) : null,
          archiveReason: row.archiveReason,
          thumbnailUrl,
          viewUrl,
          storageKey: showLocation ? row.storageKey : null,
        };
      }),
    );
  }
}
