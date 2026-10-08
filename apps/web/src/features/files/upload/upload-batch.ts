import {
  classifyUpload,
  type FileCategory,
  type FileKind,
  type FileSubCategory,
  isSubCategoryOf,
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  type SaveFileInput,
  type ToothCode,
} from '@dcm/contracts';

/**
 * The upload panel's batch (feature 8, F2–F5): the files dropped together, what each will be
 * saved with, and how far each upload is. Pure state and transitions; the hook around it
 * (`use-uploader.ts`) does the uploading.
 *
 * "Apply to all" (F4): the header holds one set of metadata for every tile. A tile keeps only
 * what it was given individually (`own`); everything else follows the header. Setting a field
 * in the header sets it for every tile, so the tiles' own values of that field are dropped. A
 * tile with anything of its own shows the "edited" dot.
 */
export interface FileMeta {
  category: FileCategory | null;
  subCategory: FileSubCategory | null;
  toothCode: ToothCode | null;
  visitId: string | null;
  note: string;
}

export const EMPTY_META: FileMeta = {
  category: null,
  subCategory: null,
  toothCode: null,
  visitId: null,
  note: '',
};

export type Refusal = 'unsupported' | 'dicom' | 'too_large' | 'too_many';

export type TileStatus = 'uploading' | 'uploaded' | 'failed' | 'refused';

export interface Tile {
  /** Local to the panel; the server's id arrives with the upload. */
  key: string;
  file: File;
  kind: FileKind | null;
  mimeType: string;
  status: TileStatus;
  refusal: Refusal | null;
  /** 0–1 while uploading. */
  progress: number;
  /** The pending upload on the server, once it has one. */
  uploadId: string | null;
  /** An object URL of the thumbnail the browser made, for the tile. */
  previewUrl: string | null;
  exifTakenAt: string | null;
  own: Partial<FileMeta>;
}

export interface Batch {
  header: FileMeta;
  tiles: Tile[];
}

export type BatchAction =
  | { type: 'add'; files: readonly { key: string; file: File }[] }
  | { type: 'header'; patch: Partial<FileMeta> }
  | { type: 'tile'; key: string; patch: Partial<FileMeta> }
  | { type: 'progress'; key: string; progress: number }
  | { type: 'prepared'; key: string; previewUrl: string | null; exifTakenAt: string | null }
  | { type: 'started'; key: string; uploadId: string }
  | { type: 'uploaded'; key: string }
  | { type: 'failed'; key: string }
  | { type: 'retry'; key: string }
  | { type: 'remove'; key: string };

/** Changing the category keeps the type only when it belongs to the new one. */
function settle(meta: FileMeta): FileMeta {
  const fits =
    meta.category !== null &&
    meta.subCategory !== null &&
    isSubCategoryOf(meta.category, meta.subCategory);
  return fits ? meta : { ...meta, subCategory: null };
}

/** What a tile will be saved with: the header, then what the tile was given itself. */
export function metaOf(batch: Batch, tile: Tile): FileMeta {
  return settle({ ...batch.header, ...tile.own });
}

/** The "edited" dot: the tile differs from the header. */
export function isEdited(batch: Batch, tile: Tile): boolean {
  const meta = metaOf(batch, tile);
  const header = settle(batch.header);
  return (Object.keys(header) as (keyof FileMeta)[]).some((field) => meta[field] !== header[field]);
}

function newTile(key: string, file: File, slotsLeft: number): Tile {
  const upload = classifyUpload(file.name, file.type);
  const refusal: Refusal | null = !upload.accepted
    ? upload.reason
    : file.size > MAX_FILE_BYTES
      ? 'too_large'
      : slotsLeft <= 0
        ? 'too_many'
        : null;
  return {
    key,
    file,
    kind: upload.accepted ? upload.kind : null,
    mimeType: upload.accepted ? upload.mimeType : file.type,
    status: refusal ? 'refused' : 'uploading',
    refusal,
    progress: 0,
    uploadId: null,
    previewUrl: null,
    exifTakenAt: null,
    own: {},
  };
}

const counts = (tile: Tile) => tile.status !== 'refused';

function patchTile(batch: Batch, key: string, change: (tile: Tile) => Tile): Batch {
  return { ...batch, tiles: batch.tiles.map((tile) => (tile.key === key ? change(tile) : tile)) };
}

export function batchReducer(batch: Batch, action: BatchAction): Batch {
  switch (action.type) {
    case 'add': {
      const tiles = [...batch.tiles];
      for (const { key, file } of action.files) {
        tiles.push(newTile(key, file, MAX_BATCH_FILES - tiles.filter(counts).length));
      }
      return { ...batch, tiles };
    }
    case 'header': {
      const fields = Object.keys(action.patch) as (keyof FileMeta)[];
      // A new category also decides the type for everyone.
      const dropped = fields.includes('category') ? [...fields, 'subCategory' as const] : fields;
      return {
        header: settle({ ...batch.header, ...action.patch }),
        tiles: batch.tiles.map((tile) => ({
          ...tile,
          own: Object.fromEntries(
            Object.entries(tile.own).filter(([field]) => !dropped.some((name) => name === field)),
          ),
        })),
      };
    }
    case 'tile':
      return patchTile(batch, action.key, (tile) => {
        const meta = settle({ ...metaOf(batch, tile), ...action.patch });
        const header = settle(batch.header);
        const own: Partial<FileMeta> = {};
        for (const field of Object.keys(meta) as (keyof FileMeta)[]) {
          if (meta[field] !== header[field]) Object.assign(own, { [field]: meta[field] });
        }
        return { ...tile, own };
      });
    case 'progress':
      return patchTile(batch, action.key, (tile) =>
        tile.status === 'uploading' ? { ...tile, progress: action.progress } : tile,
      );
    case 'prepared':
      return patchTile(batch, action.key, (tile) => ({
        ...tile,
        previewUrl: action.previewUrl,
        exifTakenAt: action.exifTakenAt,
      }));
    case 'started':
      return patchTile(batch, action.key, (tile) => ({ ...tile, uploadId: action.uploadId }));
    case 'uploaded':
      return patchTile(batch, action.key, (tile) => ({ ...tile, status: 'uploaded', progress: 1 }));
    case 'failed':
      return patchTile(batch, action.key, (tile) => ({
        ...tile,
        status: 'failed',
        uploadId: null,
      }));
    case 'retry':
      return patchTile(batch, action.key, (tile) =>
        tile.status === 'failed' ? { ...tile, status: 'uploading', progress: 0 } : tile,
      );
    case 'remove':
      return { ...batch, tiles: batch.tiles.filter((tile) => tile.key !== action.key) };
  }
}

export interface BatchStatus {
  /** The tiles Save will write: uploaded, nothing else. */
  ready: Tile[];
  uploading: number;
  /** Uploaded tiles still without a category: what keeps Save disabled (F3). */
  uncategorised: number;
  canSave: boolean;
  totalBytes: number;
}

export function batchStatus(batch: Batch): BatchStatus {
  const ready = batch.tiles.filter((tile) => tile.status === 'uploaded');
  const uploading = batch.tiles.filter((tile) => tile.status === 'uploading').length;
  const uncategorised = ready.filter((tile) => metaOf(batch, tile).category === null).length;
  return {
    ready,
    uploading,
    uncategorised,
    canSave: ready.length > 0 && uploading === 0 && uncategorised === 0,
    totalBytes: batch.tiles.filter(counts).reduce((sum, tile) => sum + tile.file.size, 0),
  };
}

/** The Save request's files; only called when `canSave`. */
export function saveItems(batch: Batch): SaveFileInput[] {
  return batchStatus(batch).ready.flatMap((tile) => {
    const meta = metaOf(batch, tile);
    if (tile.uploadId === null || meta.category === null) return [];
    return [
      {
        id: tile.uploadId,
        category: meta.category,
        subCategory: meta.subCategory,
        toothCode: meta.toothCode,
        visitId: meta.visitId,
        note: meta.note.trim(),
        exifTakenAt: tile.exifTakenAt,
      },
    ];
  });
}

/** Whether closing the panel throws work away (F2): anything uploaded or still uploading. */
export function hasWork(batch: Batch): boolean {
  return batch.tiles.some((tile) => tile.status === 'uploaded' || tile.status === 'uploading');
}
