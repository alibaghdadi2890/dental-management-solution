# ADR-0041: Save seals a file's objects and checks the sealed copies

- Status: Accepted
- Date: 2026-10-08
- Amends: ADR-0039 (decision 5 and its last consequence), CLAUDE.md §9

## Context

ADR-0039 left two gaps, both found by a security review of the feature 8 commit.

1. **The type of a file was whatever its name said.** `classifyUpload` decides the kind and the
   MIME type a file is stored and served with from the filename and the declared type. The bytes
   were never looked at, so anything could be stored as a "PDF" or a "JPEG".
2. **The upload URL outlived the Save.** The size was checked with a `HEAD` before the
   transaction, but the presigned `PUT` stays valid for 15 minutes and carries no size limit. After
   Save the uploader could write other bytes, of any size, under the key the file pointed to: the
   25 MB limit and "the original is never modified" both depended on the uploader not doing so.
   The `HEAD` itself raced the same URL.

A presigned `PUT` cannot be revoked or bound to a size on every S3-compatible store, and the
project does not proxy uploads through the API.

## Decision

1. **Uploads go to their own keys.** The browser uploads to
   `tenants/<tenant>/uploads/<fileId>/…`. A pending row points there.
2. **Save copies them to keys of its own**, `tenants/<tenant>/files/<fileId>/<attempt>/…`, with
   a server-side copy inside the store: the original and, for an image with previews, the display
   copy and the thumbnail. `<attempt>` is an id made by that Save. No URL that writes to a
   `files/` key is ever signed, so nothing the browser holds can change a saved file; and two
   Saves of the same upload (a double click, a retry) never write the same key, so the one that
   loses can remove its copies without touching the winner's, and cannot overwrite what the
   winner checked.
3. **Save checks the copies, not the uploads**: each is there (else 409
   `file.upload_incomplete`), is at most 25 MB (else 422 `file.too_large`), and starts with the
   bytes of the type it was accepted as (else 422 `file.type_unsupported`). The check reads the
   first 1024 bytes (`files/domain/content-check.ts`): a signature for images, PDF and the Office
   formats; no NUL byte for plain text. Previews must be JPEGs.
4. **Cleanup is best effort and never leaves a row without bytes.** A Save that fails before its
   transaction commits removes the copies it made and leaves the uploads, so it can be tried
   again. One that commits removes the uploads, and from then on never removes a copy, whatever
   fails afterwards. A failed delete is logged and leaves objects no row points to.
5. **All of it runs outside the transaction**, before it or after its commit. `files` may make
   these object-storage calls around a mutation: `HEAD`, a ranged read of the first kilobyte, a
   copy, and deletes. CLAUDE.md §9 says so.

## Consequences

- Bytes written with an upload URL after Save land on an `uploads/` key nothing reads. They are
  orphans, like an abandoned upload, for the same follow-up sweeper.
- A Save makes up to six store calls per file (three objects for an image with previews). A batch
  is at most 20 files and the calls of different files run in parallel.
- The content check is a signature check, not a parser. It stops a file passed off as another
  type; it does not prove a PDF or an image is well formed or harmless. Files are still served
  with the accepted type, from the storage origin, through short-lived signed URLs.
- The 25 MB limit is still not enforced while bytes arrive: an oversized upload reaches the store
  and is refused at Save, where it stays until swept. A size-bound upload (presigned `POST`) is a
  follow-up.
- Files saved before this decision keep their keys (`files/<fileId>/original`, without the
  attempt folder); the previews are always beside the original, so both layouts read alike.
- An empty upload is refused (422 `file.type_unsupported`, "This file is empty"). Plain text is
  accepted in UTF-8 or, with its byte order mark, UTF-16.
- A missing preview now refuses the Save (409) instead of saving a file whose thumbnail is absent.
  The SPA already discards a tile when any of its three uploads fails.
