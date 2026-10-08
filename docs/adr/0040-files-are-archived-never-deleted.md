# ADR-0040: Files are archived, never deleted

- Status: Accepted
- Date: 2026-10-07

## Context

People upload the wrong file, or the same file twice, and want it gone from the gallery. But a
patient's images are part of the clinical record, and "deleted by mistake" is not recoverable
once the object is gone.

## Decision

1. **Archive is the only removal.** An archived file keeps its row and its objects. It is hidden
   by default and shown, dimmed, under Show archived; it can be restored from the same places.
2. **Archive records who, when and an optional reason**, on the row and in the audit log
   (`file.archive`, `file.restore`).
3. **Who may archive**: `file:archive` (owner, dentist), or the uploader within 24 hours of
   uploading, so a mistake can be undone by the person who made it without waiting for a dentist.
   **Who may restore**: `file:archive`, or whoever archived the file, so the Undo of one's own
   archive always works.
4. **The rule is one pure function** in `@dcm/contracts` (`canArchiveFile`, `canRestoreFile`),
   applied by the API and used by the SPA to show or hide the action.
5. **Pending uploads are not files.** A pending upload that is discarded is deleted, row and
   objects: nothing was ever saved.

## Consequences

- Storage only grows. A retention policy and a hard delete for platform admins are later work.
- The patient's file list includes archived files; the SPA filters them.
- The 24-hour window is measured from "uploaded at" on the server's clock.
