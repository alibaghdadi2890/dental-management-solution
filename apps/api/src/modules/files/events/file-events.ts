import type { FileCategory } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `files` emits (feature 8, F15; CLAUDE.md §9: ids and minimal facts, dispatched after
 * commit). The generic audit subscriber records each one; the readable audit rows (`file.upload`,
 * `file.update`, …) are written by the service itself.
 */

interface FileFacts {
  fileId: string;
  patientId: string;
  visitId: string | null;
  toothCode: string | null;
  category: FileCategory;
}

export const FILE_UPLOADED = 'FileUploaded';
export type FileUploaded = DomainEvent<typeof FILE_UPLOADED, FileFacts>;

export const FILE_UPDATED = 'FileUpdated';
/** `fields`: what changed — metadata, the note or the stored orientation. */
export type FileUpdated = DomainEvent<typeof FILE_UPDATED, FileFacts & { fields: string[] }>;

export const FILE_ARCHIVED = 'FileArchived';
export type FileArchived = DomainEvent<typeof FILE_ARCHIVED, FileFacts>;

export const FILE_RESTORED = 'FileRestored';
export type FileRestored = DomainEvent<typeof FILE_RESTORED, FileFacts>;
