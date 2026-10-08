import { z } from 'zod';
import {
  blankToUndefined,
  commaSeparatedIds,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
} from './common.js';
import type { Permission } from './permissions.js';
import { toothCodeSchema } from './tooth.js';
import { visitStatusSchema } from './visits.js';

/**
 * `files` (feature 8): a patient's images and documents, optionally linked to a visit and a
 * tooth. One schema for the HTTP routes, the SPA and, later, the agent tools. The pure rules both
 * sides apply live here too: which uploads are accepted (F1) and who may archive a file (F13).
 */

export const FILE_KINDS = ['image', 'document'] as const;
export const fileKindSchema = z.enum(FILE_KINDS);
export type FileKind = z.infer<typeof fileKindSchema>;

export const FILE_CATEGORIES = ['xray', 'photo', 'other'] as const;
export const fileCategorySchema = z.enum(FILE_CATEGORIES);
export type FileCategory = z.infer<typeof fileCategorySchema>;

/** The optional type under each category; `other` has none. */
export const FILE_SUB_CATEGORIES = {
  xray: ['intraoral', 'panoramic', 'cephalometric', 'other'],
  photo: ['intraoral', 'extraoral', 'before_after', 'other'],
  other: [],
} as const satisfies Record<FileCategory, readonly string[]>;
export type FileSubCategory = (typeof FILE_SUB_CATEGORIES)[FileCategory][number];
export const fileSubCategorySchema = z.enum([
  'intraoral',
  'panoramic',
  'cephalometric',
  'extraoral',
  'before_after',
  'other',
]);

export function isSubCategoryOf(category: FileCategory, subCategory: string): boolean {
  return (FILE_SUB_CATEGORIES[category] as readonly string[]).includes(subCategory);
}

/** The stored rotation, clockwise, applied wherever the image renders (F8). */
export const FILE_ORIENTATIONS = [0, 90, 180, 270] as const;
export const fileOrientationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type FileOrientation = z.infer<typeof fileOrientationSchema>;

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_BATCH_FILES = 20;
export const FILE_NOTE_MAX = 2000;
const FILENAME_MAX = 255;

/** Extension → the kind and the MIME type a file is stored and served with (F1). */
const ACCEPTED: Readonly<Record<string, { kind: FileKind; mimeType: string }>> = {
  jpg: { kind: 'image', mimeType: 'image/jpeg' },
  jpeg: { kind: 'image', mimeType: 'image/jpeg' },
  png: { kind: 'image', mimeType: 'image/png' },
  webp: { kind: 'image', mimeType: 'image/webp' },
  heic: { kind: 'image', mimeType: 'image/heic' },
  heif: { kind: 'image', mimeType: 'image/heif' },
  tif: { kind: 'image', mimeType: 'image/tiff' },
  tiff: { kind: 'image', mimeType: 'image/tiff' },
  pdf: { kind: 'document', mimeType: 'application/pdf' },
  docx: {
    kind: 'document',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    kind: 'document',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  txt: { kind: 'document', mimeType: 'text/plain' },
};

const BY_MIME = new Map(Object.values(ACCEPTED).map((entry) => [entry.mimeType, entry]));

/** The MIME types and extensions a file picker should offer. */
export const ACCEPTED_UPLOADS = [
  ...BY_MIME.keys(),
  ...Object.keys(ACCEPTED).map((extension) => `.${extension}`),
].join(',');

export type UploadClass =
  | { accepted: true; kind: FileKind; mimeType: string }
  | { accepted: false; reason: 'unsupported' | 'dicom' };

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Whether an upload is accepted, and as what (F1). The extension decides when it is a known one —
 * browsers report HEIC and TIFF files with an empty or generic type — else the MIME type (a
 * pasted image has a type and an invented name). DICOM is refused with its own reason. Pure.
 */
export function classifyUpload(filename: string, mimeType: string): UploadClass {
  const extension = extensionOf(filename);
  const mime = mimeType.trim().toLowerCase();
  if (extension === 'dcm' || extension === 'dicom' || mime === 'application/dicom') {
    return { accepted: false, reason: 'dicom' };
  }
  const known = ACCEPTED[extension] ?? BY_MIME.get(mime);
  return known ? { accepted: true, ...known } : { accepted: false, reason: 'unsupported' };
}

/** Images a browser cannot draw on its own: decoded before a preview can be made (F1). */
export function needsDecoder(mimeType: string): 'heic' | 'tiff' | null {
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  return mimeType === 'image/tiff' ? 'tiff' : null;
}

/** The uploader may archive their own upload for this long (F13). */
export const UPLOADER_ARCHIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface FileActor {
  userId: string;
  can: (permission: Permission) => boolean;
}

/**
 * F13: `file:archive` (owner, dentist; a platform admin holds every permission), or the file's
 * uploader — still able to write files — within 24 h of uploading it. Pure.
 */
export function canArchiveFile(
  actor: FileActor,
  file: { uploadedBy: string; uploadedAt: string },
  now: Date,
): boolean {
  if (actor.can('file:archive')) return true;
  return (
    actor.can('file:write') &&
    file.uploadedBy === actor.userId &&
    now.getTime() - new Date(file.uploadedAt).getTime() <= UPLOADER_ARCHIVE_WINDOW_MS
  );
}

/** `file:archive`, or whoever archived it: the Undo of one's own archive always works. Pure. */
export function canRestoreFile(actor: FileActor, file: { archivedBy: string | null }): boolean {
  if (actor.can('file:archive')) return true;
  return actor.can('file:write') && file.archivedBy === actor.userId;
}

// --- Upload ---

/** `POST /files/uploads`: one file about to be uploaded. `preview`: the browser made a display
 * copy and a thumbnail and will upload them too. */
export const uploadIntentSchema = z.object({
  patientId: idSchema,
  filename: z.string().trim().min(1).max(FILENAME_MAX),
  mimeType: z.string().max(200),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
  preview: z.boolean(),
});
export type UploadIntent = z.infer<typeof uploadIntentSchema>;

export const uploadTargetSchema = z.object({
  id: idSchema,
  /** The stored MIME type: the `Content-Type` the original must be sent with. */
  mimeType: z.string(),
  uploadUrl: z.string(),
  displayUploadUrl: z.string().nullable(),
  thumbnailUploadUrl: z.string().nullable(),
});
export type UploadTarget = z.infer<typeof uploadTargetSchema>;

/** `DELETE /files/uploads?ids=`: the caller's pending uploads to throw away. */
export const discardUploadsQuerySchema = z.object({ ids: commaSeparatedIds(MAX_BATCH_FILES) });

/** EXIF `DateTimeOriginal` as the camera wrote it: a wall-clock time with no zone. */
export const exifDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, 'Expected YYYY-MM-DDTHH:mm:ss');

const noteSchema = z.string().trim().max(FILE_NOTE_MAX);

const subCategoryIssue = 'This type does not belong to the category';

export const saveFileSchema = z
  .object({
    id: idSchema,
    category: fileCategorySchema,
    subCategory: fileSubCategorySchema.nullish(),
    toothCode: toothCodeSchema.nullish(),
    visitId: idSchema.nullish(),
    note: noteSchema.optional(),
    exifTakenAt: exifDateTimeSchema.nullish(),
  })
  .refine((file) => !file.subCategory || isSubCategoryOf(file.category, file.subCategory), {
    path: ['subCategory'],
    message: subCategoryIssue,
  });
export type SaveFileInput = z.infer<typeof saveFileSchema>;

/** `POST /files`: the Save of an upload batch (F2, F4). */
export const saveFilesSchema = z.object({
  patientId: idSchema,
  files: z.array(saveFileSchema).min(1).max(MAX_BATCH_FILES),
});
export type SaveFilesInput = z.infer<typeof saveFilesSchema>;

// --- Read ---

/** The visit a file was taken in, as the gallery and the viewer name it (F11). */
export const fileVisitSchema = z.object({
  id: idSchema,
  displayNumber: z.number().int().positive(),
  localDate: isoDateSchema,
  status: visitStatusSchema,
});
export type FileVisit = z.infer<typeof fileVisitSchema>;

export const patientFileSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  kind: fileKindSchema,
  category: fileCategorySchema,
  subCategory: fileSubCategorySchema.nullable(),
  toothCode: toothCodeSchema.nullable(),
  /** Null when not linked, or when the caller may not read visits. */
  visit: fileVisitSchema.nullable(),
  visitId: idSchema.nullable(),
  takenAt: isoDateTimeSchema,
  note: z.string(),
  originalFilename: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string(),
  orientation: fileOrientationSchema,
  uploadedBy: idSchema,
  uploadedByName: z.string().nullable(),
  uploadedAt: isoDateTimeSchema,
  archivedAt: isoDateTimeSchema.nullable(),
  archivedBy: idSchema.nullable(),
  archivedByName: z.string().nullable(),
  archiveReason: z.string().nullable(),
  /** Short-lived signed URLs (F14). Null for a file with no preview (a document's thumbnail, an
   * image the browser could not decode). `viewUrl` of a document is the original, served inline. */
  thumbnailUrl: z.string().nullable(),
  viewUrl: z.string().nullable(),
  /** Owners and platform admins only. */
  storageKey: z.string().nullable(),
});
export type PatientFile = z.infer<typeof patientFileSchema>;

export const patientFilesQuerySchema = z.object({ patientId: idSchema });
export const patientFilesSchema = z.object({ items: z.array(patientFileSchema) });
export type PatientFiles = z.infer<typeof patientFilesSchema>;

// --- Change ---

export const filePatchSchema = z
  .object({
    category: fileCategorySchema.optional(),
    subCategory: fileSubCategorySchema.nullable().optional(),
    toothCode: toothCodeSchema.nullable().optional(),
    visitId: idSchema.nullable().optional(),
    takenAt: isoDateTimeSchema.optional(),
    note: noteSchema.optional(),
    orientation: fileOrientationSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Nothing to change',
  });
export type FilePatch = z.infer<typeof filePatchSchema>;

const fileIdsSchema = z.array(idSchema).min(1).max(100);

/** `PATCH /files`: one file from the viewer, or several from the gallery's bulk bar. */
export const updateFilesSchema = z.object({ ids: fileIdsSchema, patch: filePatchSchema });
export type UpdateFilesInput = z.infer<typeof updateFilesSchema>;

export const archiveFilesSchema = z.object({
  ids: fileIdsSchema,
  reason: blankToUndefined(z.string().trim().max(500).optional()),
});
export type ArchiveFilesInput = z.infer<typeof archiveFilesSchema>;

export const restoreFilesSchema = z.object({ ids: fileIdsSchema });
export type RestoreFilesInput = z.infer<typeof restoreFilesSchema>;

export const fileDownloadSchema = z.object({ url: z.string() });
export type FileDownload = z.infer<typeof fileDownloadSchema>;
