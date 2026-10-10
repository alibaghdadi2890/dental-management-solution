# Feature 8: patient files — design

Source: the feature 8 prompt (F1–F15, screens 1–5, acceptance). This page records only what the
prompt leaves open, as decisions D1–D20, and the contracts. Where a decision narrows the prompt it
says so.

## Decisions

| #   | Topic                      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Module                     | New `files` module. Owns one table, `files`. Depends on `patients` (lock, existence), `clinical` (a visit's patient, number, date, status), `users` (uploader names), `tenancy` (time zone), `audit`. Reacts to `PatientsMerged` in the merge transaction. Nothing depends on `files`; the SPA composes it into the record and the workspace. ADR-0038.                                                                                                                                                          |
| D2  | Where the bytes go         | The browser uploads straight to object storage with presigned `PUT` URLs. The API never proxies bytes.                                                                                                                                                                                                                                                                                                                                                                                                           |
| D3  | Display copy and thumbnail | Made **in the browser** before upload (canvas): a display JPEG (long edge ≤ 2560 px) and a thumbnail JPEG (long edge ≤ 480 px). Drawing through a canvas honours EXIF orientation and drops all EXIF, GPS included (F8, F14). HEIC/HEIF and TIFF are decoded by lazily loaded decoders (`heic-to`, `utif2`). The original is uploaded untouched. No server image processing, no queue (no new Redis usage). An image the browser cannot decode is still saved; it shows as a typed tile with Download. ADR-0039. |
| D4  | Storage keys               | `tenants/<tenant>/files/<fileId>/original`, `…/display.jpg`, `…/thumb.jpg`. No patient id in the key, so a merge moves no objects.                                                                                                                                                                                                                                                                                                                                                                               |
| D5  | Pending uploads            | `POST /files/uploads` creates a **pending** row (`saved_at` null) and answers with the upload URLs. Save turns pending rows into files. Pending rows are invisible everywhere. Discard (`DELETE /files/uploads`) deletes the caller's pending rows and, after commit, their objects (best effort). A browser closed mid-upload leaves pending rows and objects behind: follow-up, a sweeper.                                                                                                                     |
| D6  | Object checks              | On Save the API `HEAD`s each original before the transaction: missing → 409 `file.upload_incomplete`; larger than 25 MB → 422 `file.too_large`. Together with discard's delete these are the only object-storage calls `files` makes in a mutating request, both outside the transaction. CLAUDE.md §9 gains the exception. ADR-0039.                                                                                                                                                                            |
| D7  | Serving                    | The list carries presigned `GET` URLs (15 min) for the thumbnail and the display copy (for a document: the original, `inline`). `GET /files/:id/download` answers a 60 s URL with `attachment; filename=<original filename>`. Never a public link; a URL is only ever signed for a row RLS let the caller read (F14).                                                                                                                                                                                            |
| D8  | One read                   | `GET /files?patientId=` returns every saved file of the patient, archived included, newest "taken on" first (cap 1000). Gallery filters, search, grouping, the tab badge, the visit strip, the tooth row, the Overview card and the quick-view line all derive from this one query in the SPA, so one invalidation refreshes every surface.                                                                                                                                                                      |
| D9  | Category                   | `category` `xray` · `photo` · `other`; `subCategory` per F-table; text + Zod, a CHECK that a saved row has a category. "Documents" in the gallery filter is `kind = document`, not a category.                                                                                                                                                                                                                                                                                                                   |
| D10 | Taken on                   | `taken_at timestamptz`. At save: the EXIF `DateTimeOriginal` (read in the browser, sent as a wall-clock time, read as tenant-local) when it is not in the future, else the visit's `startedAt` when linked to a visit, else now. Editable later; refused when its tenant-local date is after today. The upload panel has no date field (the prompt lists none).                                                                                                                                                  |
| D11 | Uploaded at / by           | `saved_at` and `uploaded_by` (auth user id, §7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D12 | Rotation                   | `orientation` 0/90/180/270, applied by CSS wherever the image renders. Bytes never change.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D13 | Archive rule               | Pure, in `@dcm/contracts` (`canArchiveFile`), used by API and SPA: `file:archive`, or the uploader with `file:write` within 24 h of `uploadedAt`. Restore: `file:archive`, or whoever archived it (so the uploader's Undo works).                                                                                                                                                                                                                                                                                |
| D14 | Permissions                | New `file:read` (all four system roles), `file:write` (all four), `file:archive` (owner, dentist). Migration grants them to existing system roles. Storage location is returned only to callers with `tenant:write` (owners and platform admins; `files` does not read roles).                                                                                                                                                                                                                                   |
| D15 | Visit link                 | The visit must be the patient's, not discarded: else 422 `file.visit_mismatch`. A file keeps its visit through complete, amend and void; the list carries the visit's status so the SPA writes "visit voided".                                                                                                                                                                                                                                                                                                   |
| D16 | Edits                      | `PATCH /files` takes `ids` + a patch (one file from the viewer, several from the bulk bar). One `file.update` audit row per changed file, before → after of the changed fields only.                                                                                                                                                                                                                                                                                                                             |
| D17 | Audit and events           | Actions `file.upload`, `file.update`, `file.archive`, `file.restore`, `file.repoint`; new Activity area `files`. Events `FileUploaded`, `FileUpdated`, `FileArchived`, `FileRestored` (ids + category, tooth). The viewer's History reads `GET /audit?resourceType=file` and needs `audit:read`.                                                                                                                                                                                                                 |
| D18 | Batch limits               | 25 MB per file, 20 files per batch, enforced in the SPA and by the API (size at intent and at Save; batch size at Save).                                                                                                                                                                                                                                                                                                                                                                                         |
| D19 | Merge                      | `MergeFilesSubscriber` re-points every row, pending and archived included, in the merge transaction; audited `file.repoint` when anything moved (F12).                                                                                                                                                                                                                                                                                                                                                           |
| D20 | Patients                   | Files can be added to an archived patient (a late referral letter); a merged-away patient is refused, as for the ledger.                                                                                                                                                                                                                                                                                                                                                                                         |

Narrowed from the prompt:

- "Same mini tooth picker the rest of the app uses": there is none. The tooth field is a number input in the clinic's notation plus a small popover holding the existing `DentalChart`.
- "On touch devices the picker also offers the camera": **Take photo** is a file input with `capture="environment"`.
- The gallery modal in a visit reuses the Files tab component in a dialog.
- History in the viewer is hidden without `audit:read` (assistant, front desk).

## Table

`files` (RLS, tenant index):

`id`, `tenant_id`, `patient_id`, `visit_id` null, `tooth_code` null (CHECK format), `kind`
(`image` · `document`), `category` null, `sub_category` null, `taken_at` null, `note` text
default '', `original_filename`, `size_bytes` bigint, `mime_type`, `storage_key`, `has_preview`
bool, `orientation` smallint default 0 (CHECK 0/90/180/270), `uploaded_by`, `saved_at` null,
`archived_at` null, `archived_by` null, `archive_reason` null, `created_at`, `updated_at`.

CHECK `saved_at is null or (category is not null and taken_at is not null)`. Index
`(tenant_id, patient_id, taken_at desc)`. FK to `visits (tenant_id, id)` is not declared: `files`
owns no clinical table and module tables do not reference each other across modules (as
`ledger_entries.visit_id`).

## Contracts (`packages/contracts/src/files.ts`)

- `FILE_CATEGORIES`, `FILE_SUB_CATEGORIES` (per category), `FILE_KINDS`, `FILE_ORIENTATIONS`,
  `MAX_FILE_BYTES`, `MAX_BATCH_FILES`.
- `classifyUpload(filename, mimeType)` → `{ kind, mimeType }` or `{ refused: 'unsupported' | 'dicom' }` (F1; by MIME, falling back to the extension).
- `canArchiveFile(actor, file, now)`, `canRestoreFile(actor, file)`.
- `uploadIntentSchema` `{ patientId, filename, mimeType, sizeBytes, preview }` →
  `uploadTargetSchema` `{ id, uploadUrl, displayUploadUrl, thumbnailUploadUrl }` (nullable).
- `saveFilesSchema` `{ patientId, files: [{ id, category, subCategory?, toothCode?, visitId?, note?, exifTakenAt? }] }` (1–20).
- `patientFileSchema`: id, patientId, kind, category, subCategory, toothCode, visit
  `{ id, displayNumber, localDate, status } | null`, takenAt, note, originalFilename, sizeBytes,
  mimeType, orientation, uploadedBy, uploadedByName, uploadedAt, archivedAt, archivedBy,
  archiveReason, thumbnailUrl, viewUrl, storageKey (nullable).
- `patientFilesSchema` `{ items }`; `updateFilesSchema` `{ ids, patch: { category?, subCategory?, toothCode?, visitId?, takenAt?, note?, orientation? } }`;
  `archiveFilesSchema` `{ ids, reason? }`; `restoreFilesSchema` `{ ids }`; `fileDownloadSchema` `{ url }`.

## Routes (`/api/v1/files`)

| Route                                         | Permission                  | Notes                           |
| --------------------------------------------- | --------------------------- | ------------------------------- |
| `POST /files/uploads`                         | `file:write`                | pending row + upload URLs       |
| `DELETE /files/uploads?ids=`                  | `file:write`                | discard own pending rows        |
| `POST /files`                                 | `file:write`                | Save a batch; 201 `{ items }`   |
| `GET /files?patientId=`                       | `file:read`                 | `{ items }`                     |
| `PATCH /files`                                | `file:write`                | `{ items }` (the changed files) |
| `POST /files/archive` · `POST /files/restore` | `file:write` + D13 per file | `{ items }`                     |
| `GET /files/:id/download`                     | `file:read`                 | `{ url }`                       |

Errors: `file.not_found` 404, `file.type_unsupported` 422, `file.too_large` 422,
`file.upload_incomplete` 409, `file.visit_mismatch` 422, `file.archive_forbidden` 403,
`file.taken_in_future` 422 (validation path `takenAt`).

## SPA (`apps/web/src/features/files/`)

One provider in the app shell mounts the upload panel and the viewer; `useFiles()` gives
`openUpload({ patientId, visitId?, toothCode?, files? })` and
`openViewer({ patientId, ids, startId, compareIds? })`. A `FileDropSurface` hook adds the drop
overlay and paste to the record and the workspace. Session memory of the last category lives in
`sessionStorage`. The viewer and the panel are overlays; the record's Files tab is `?tab=files`,
and `?file=<id>` opens the viewer on arrival (the Activity link).

Pure and unit-tested: the upload batch reducer (tiles, "apply to all", edited dot, Save count),
gallery filter + date grouping, viewer zoom math, EXIF parsing, the rotation helper.

## Out of scope / follow-ups

Sweeping abandoned pending uploads; server-side re-derivation of previews; a size-signed upload
URL; making an upload URL unusable once its file is saved (ADR-0039); reaching a toast's action
by keyboard from inside a modal; everything in the prompt's own Out of scope list.

## Implementation notes (2026-10-07)

- `file.type_unsupported` carries its reason in the message ("DICOM files are not supported");
  the SPA classifies before it asks, so it never needs the reason from the API.
- The read returns `visitId: null` for a file whose visit was discarded since (a visit holding
  only files can be discarded; ADR-0038).
- The upload panel and the viewer are dialog layers of their own (Radix), so both work over the
  dialogs they are opened from: the post-visit summary and a visit's All files. Toasts moved above
  the dialogs' layer, so "Archived · Undo" shows over the viewer.
- Session memory applies when every file of the first drop is an image; a batch with a document
  opens with no category (the acceptance's "PDF defaults to no category").
- Compare orders its two images older first.
- The visit strip keeps **All files** beside the scrolling thumbnails, not at their end.
- The viewer's "taken on" field is a `datetime-local` read and written in the clinic's time zone
  (`lib/zoned-time.ts`).

## Hardening (2026-10-08, ADR-0041)

D4 and D6 changed: uploads go to `tenants/<tenant>/uploads/<fileId>/…`, and Save copies them to
the `files/` keys, then checks the copies' size and first bytes. That closes the follow-up
"making an upload URL unusable once its file is saved" and adds the content check; a size-signed
upload URL stays a follow-up.
