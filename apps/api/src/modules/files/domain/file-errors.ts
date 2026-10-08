import { DomainError } from '../../../platform/kernel/domain-error';

/** Unknown, another clinic's, or — for a save or a discard — not the caller's pending upload. */
export class FileNotFoundError extends DomainError {
  readonly code = 'file.not_found';
  readonly kind = 'not_found';
}

/** F1: not an accepted image or document (DICOM included; the message says which). */
export class FileTypeUnsupportedError extends DomainError {
  readonly code = 'file.type_unsupported';
  readonly kind = 'invalid';
}

/** The stored object is larger than the limit the upload was allowed (F1). */
export class FileTooLargeError extends DomainError {
  readonly code = 'file.too_large';
  readonly kind = 'invalid';
}

/** Save came before the bytes: nothing is stored under the upload's key yet (F2). */
export class FileUploadIncompleteError extends DomainError {
  readonly code = 'file.upload_incomplete';
  readonly kind = 'conflict';
}

/** The visit is not one of this patient's visits. */
export class FileVisitMismatchError extends DomainError {
  readonly code = 'file.visit_mismatch';
  readonly kind = 'invalid';
}

/** F13: neither `file:archive` nor the uploader within 24 hours (or, to restore, the archiver). */
export class FileArchiveForbiddenError extends DomainError {
  readonly code = 'file.archive_forbidden';
  readonly kind = 'forbidden';
}
