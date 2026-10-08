# `files` module

**Status:** built in feature 8 (patient files). Spec
`docs/superpowers/specs/2026-10-07-patient-files-design.md`; ADR-0038 to ADR-0040.

## Purpose

A patient's images (X-rays, photos) and documents: uploading them, reading them back, editing
what is known about them, archiving them. A file belongs to a patient, always, and optionally to a
visit and to a tooth. The bytes live in object storage; this module owns the metadata and decides
who gets a signed URL.

Not here: DICOM and imaging devices, drawing on images, sharing with patients, OCR, versions,
hard delete, storage quotas, bulk import.

## Owns

`files` (tenant RLS, index `(tenant_id, patient_id, taken_at desc)`):

| Column                                         | Notes                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `patient_id`                                   | required; no foreign key (`patients` owns that table). Only the merge re-point changes it. |
| `visit_id`                                     | optional; no foreign key (`clinical` owns `visits`).                                       |
| `tooth_code`                                   | optional; one FDI code, either dentition (CHECK on the format).                            |
| `kind`                                         | `image` or `document` (text + Zod), decided from the filename and MIME type at upload.     |
| `category`, `sub_category`                     | `xray` · `photo` · `other`, and the type under it (text + Zod). Null while pending.        |
| `taken_at`                                     | when the image was taken: what the gallery sorts and groups by. Null while pending.        |
| `note`                                         | free text, `''` when empty.                                                                |
| `original_filename`, `size_bytes`, `mime_type` | read-only. The size is the stored object's, read at Save.                                  |
| `storage_key`, `has_preview`                   | where the original is; whether a display copy and a thumbnail sit beside it.               |
| `orientation`                                  | 0 / 90 / 180 / 270, clockwise, applied on render.                                          |
| `uploaded_by`, `saved_at`                      | the auth user id of the uploader; "uploaded at". `saved_at` null = a pending upload.       |
| `archived_at`, `archived_by`, `archive_reason` | the soft archive.                                                                          |

CHECKs: a saved row has a category and a `taken_at`; `archived_at` and `archived_by` are set
together; the orientation is one of the four.

## States

```
pending ──Save──▶ saved ──archive──▶ archived
   │                ▲                    │
   └─discard (row and objects deleted)   └──restore──┘
```

- **Pending**: created when the browser asks where to upload (`requestUpload`). Invisible to every
  read. Belongs to its uploader: only they can save or discard it.
- **Saved**: a file. Its category, links, note, "taken on" and orientation can be edited.
- **Archived**: hidden by default in the SPA, still in the read; restorable. Nothing is hard-deleted
  (ADR-0040).

A pending upload whose browser was closed stays behind, row and objects. A sweeper is a follow-up.

## Storage and URL policy (ADR-0039)

Keys: `tenants/<tenant>/files/<fileId>/original`, and for an image the browser could decode,
`…/display.jpg` (long edge ≤ 2560 px) and `…/thumb.jpg` (≤ 480 px). No patient id in the key: a
merge moves no objects.

- **Upload**: the browser `PUT`s to presigned URLs (15 min). The API never carries the bytes.
- **Previews are made in the browser**, on a canvas: that turns the picture upright from its EXIF
  orientation and writes JPEGs with no EXIF, so no GPS position reaches the display copy. HEIC/HEIF
  and TIFF are decoded by lazily loaded decoders. The original is uploaded untouched and never
  modified afterwards.
- **Read**: `GET /files` answers presigned `GET` URLs (15 min) for the thumbnail and for what the
  viewer shows: the display copy, or a document's original served `inline`. An image the browser
  could not decode has neither and shows as a typed tile.
- **Download**: `GET /files/:id/download` answers a 60 s URL with
  `Content-Disposition: attachment; filename=<original filename>`: the original bytes.
- Never a public link. A URL is only signed for a row the caller's tenant can read (RLS), under a
  key of that tenant (`ObjectStorage` refuses any other).
- **Object checks**: on Save the API `HEAD`s each original (missing → 409, over 25 MB → 422);
  after a discard it deletes the objects, best effort. Both run outside the transaction; they are
  the only object-storage calls made around a mutation.

The bucket needs CORS for the SPA's origin (`PUT`, `GET`). SeaweedFS in Docker Compose allows it
by default.

## Rules

- **Accepted files** (`classifyUpload`, shared with the SPA): JPEG, PNG, WebP, HEIC/HEIF, TIFF;
  PDF, DOCX, XLSX, plain text. 25 MB per file, 20 files per Save. DICOM is refused by name.
- **Category** is required to save; the type must belong to the category. Changing the category
  of a saved file drops a type that does not belong to the new one.
- **Taken on** at Save (`deriveTakenAt`): the camera's `DateTimeOriginal` (sent by the browser as a
  wall-clock time, read in the tenant's time zone) when it is not in the future; else the start of
  the linked visit; else now. Edited later, it is refused when its tenant-local date is after
  today.
- **Visit link**: the visit must be the same patient's and not discarded (422
  `file.visit_mismatch`). Completing, amending or voiding the visit changes nothing here; the read
  carries the visit's status so the SPA can say "visit voided".
- **Who may archive** (`canArchiveFile`, shared with the SPA): `file:archive`, or the uploader,
  still holding `file:write`, within 24 hours of `saved_at`. **Restore**: `file:archive`, or
  whoever archived the file.
- **Patients**: a merged-away patient is refused (409 `patient.merged`); an archived one accepts
  files.
- **Storage location** is returned only to callers with `tenant:write` (owners; platform admins
  acting in the clinic).

## Public API (`index.ts`)

`FilesModule`, `FilesService`, the events.

| Method                 | Permission              | Notes                                                                                                                                                                           |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestUpload(input)` | `file:write`            | A pending row and the upload URLs. 422 `file.type_unsupported`.                                                                                                                 |
| `discardUploads(ids)`  | `file:write`            | Deletes the caller's pending rows among `ids` and their objects. Others' and saved ids are ignored.                                                                             |
| `save(input)`          | `file:write`            | The caller's pending uploads for the patient become files, all or nothing. 404 `file.not_found`, 409 `file.upload_incomplete`, 422 `file.too_large`, 422 `file.visit_mismatch`. |
| `list(patientId)`      | `file:read`             | Every saved file, archived included, most recently taken first, at most 1000, with signed URLs.                                                                                 |
| `download(id)`         | `file:read`             | `{ url }` for the original.                                                                                                                                                     |
| `update(input)`        | `file:write`            | One patch for one or several files; unchanged files are not written. 422 `validation_failed` (`patch.takenAt`) for a future date.                                               |
| `archive(input)`       | `file:write` + the rule | 403 `file.archive_forbidden` for the whole request when one file may not be archived by the caller. Already archived → unchanged.                                               |
| `restore(input)`       | `file:write` + the rule | Likewise.                                                                                                                                                                       |

Every method takes one Zod-validated object or ids and returns plain data, so each can become an
agent tool.

## HTTP (`/api/v1/files`)

| Route                        | Permission   | Body / answer                                   |
| ---------------------------- | ------------ | ----------------------------------------------- |
| `POST /files/uploads`        | `file:write` | `uploadIntentSchema` → 201 `uploadTargetSchema` |
| `DELETE /files/uploads?ids=` | `file:write` | → 204                                           |
| `POST /files`                | `file:write` | `saveFilesSchema` → 201 `{ items }`             |
| `GET /files?patientId=`      | `file:read`  | → `{ items }`                                   |
| `PATCH /files`               | `file:write` | `updateFilesSchema` → `{ items }`               |
| `POST /files/archive`        | `file:write` | `archiveFilesSchema` → `{ items }`              |
| `POST /files/restore`        | `file:write` | `restoreFilesSchema` → `{ items }`              |
| `GET /files/:id/download`    | `file:read`  | → `{ url }`                                     |

No `Idempotency-Key`: a retried Save finds the uploads already saved and answers 404; the batch
was written once.

## Audit and events

Audit rows (area `files`, about the patient and, when linked, the visit): `file.upload`,
`file.update` (before → after of what changed), `file.archive` (with the reason), `file.restore`,
and `file.repoint` on the kept patient of a merge. Pending uploads are not records: requesting
and discarding one is not audited.

Events (ids, category, tooth, visit): `FileUploaded`, `FileUpdated` (with the changed `fields`),
`FileArchived`, `FileRestored`.

## Depends on

`patients` (`lockForDependentWrite`; consumes `PatientsMerged` in the merge transaction),
`clinical` (`VisitsService.refsFor`), `users` (`namesByUserIds`), `tenancy` (the time zone),
`audit`. Platform: `ObjectStorage`. Nothing imports `files`.

## Permissions

`file:read` and `file:write`: owner, dentist, assistant, front desk. `file:archive`: owner,
dentist. Migration `0038_files` grants them to the system roles of tenants seeded before it.

## SPA (`apps/web/src/features/files/`)

- One query per patient (`patientFilesQuery`) feeds every surface: the record's **Files** tab
  (`gallery/files-gallery.tsx`), the Overview's Recent files card, the tooth panel's Images row,
  the visit workspace's Files strip and its All files dialog, the post-visit summary's line and the
  quick view's line (`file-rows.tsx`).
- `FilesProvider` (app shell) mounts the upload panel (`upload/`) and the viewer (`viewer/`);
  `useFiles()` opens them. `FileDropSurface` adds the drop overlay and paste to the record and the
  workspace.
- Pure and unit-tested: the upload batch (`upload/upload-batch.ts`), the gallery filters and
  groups (`gallery/gallery-filter.ts`), the viewer's zoom (`viewer/zoom.ts`), EXIF reading
  (`exif.ts`), rotation (`rotation.ts`).
- `?tab=files&file=<id>` on the record opens the viewer on that file (the Activity screen's link).
- The last category and type saved in a browser session are remembered in `sessionStorage` and
  pre-selected for the next upload of images.

## Tests

`apps/api/test/integration/files.int-spec.ts`; the `files` block of
`tenant-isolation-services.int-spec.ts`; domain specs (`taken-at`, `file-changes`); contracts
`files.spec.ts` (accepted types, the archive rule); web `features/files/*.spec.ts(x)`; Playwright
`apps/web/e2e/files.spec.ts`.
