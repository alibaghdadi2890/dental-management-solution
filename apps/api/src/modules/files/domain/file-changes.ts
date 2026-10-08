import { type FileCategory, type FilePatch, isSubCategoryOf } from '@dcm/contracts';

/** The fields of a file a person edits (F3, F5, F7–F9). */
export interface FileMetadata {
  category: FileCategory;
  subCategory: string | null;
  toothCode: string | null;
  visitId: string | null;
  takenAt: Date;
  note: string;
  orientation: number;
}

export type FileMetadataChange = Partial<FileMetadata>;

/**
 * What `patch` changes on `current`, and nothing else: a field sent with the value it already has
 * is left out, so an unchanged file is neither written nor audited. A type that does not belong
 * to the (new) category is dropped: changing a panoramic X-ray to a photo clears "Panoramic",
 * and a type sent for the wrong category is ignored. Pure.
 */
export function changesOf(current: FileMetadata, patch: FilePatch): FileMetadataChange {
  const change: FileMetadataChange = {};
  const category = patch.category ?? current.category;
  if (category !== current.category) change.category = category;

  const wanted = patch.subCategory === undefined ? current.subCategory : patch.subCategory;
  const subCategory = wanted !== null && isSubCategoryOf(category, wanted) ? wanted : null;
  if (subCategory !== current.subCategory) change.subCategory = subCategory;

  if (patch.toothCode !== undefined && patch.toothCode !== current.toothCode) {
    change.toothCode = patch.toothCode;
  }
  if (patch.visitId !== undefined && patch.visitId !== current.visitId) {
    change.visitId = patch.visitId;
  }
  if (patch.takenAt !== undefined) {
    const takenAt = new Date(patch.takenAt);
    if (takenAt.getTime() !== current.takenAt.getTime()) change.takenAt = takenAt;
  }
  if (patch.note !== undefined && patch.note !== current.note) change.note = patch.note;
  if (patch.orientation !== undefined && patch.orientation !== current.orientation) {
    change.orientation = patch.orientation;
  }
  return change;
}
