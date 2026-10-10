# ADR-0039: Originals are immutable; previews are made in the browser; orientation is stored

- Status: Accepted
- Date: 2026-10-07
- Amends: CLAUDE.md §9 (the object-storage calls `files` makes around a mutation)
- Amended by: ADR-0041 (uploads go to their own keys; Save copies and checks them)

## Context

A clinical image is evidence: the bytes that came off the sensor or the phone must stay as they
are. But the app has to show thumbnails, show a phone photo the right way up, show HEIC and TIFF
files a browser cannot draw, keep GPS positions out of what is displayed, and let a dentist
rotate an image that was scanned sideways.

Each of those needs a derived copy or a stored instruction. Where they are made matters:

- **On the server, in the request.** The API would download the upload, decode it, and write two
  copies back, inside a mutating request: slow, memory-heavy, and against §9. HEIC also needs a
  decoder the common Node image library does not ship.
- **On the server, in a job.** The right shape for heavy work, but it needs the queue, and the
  project is not adding Redis usage for now. A file would also have no thumbnail until the job ran.
- **In the browser, before upload.** The browser already decodes the image to show it. Drawing it
  on a canvas applies its EXIF orientation and produces a JPEG with no metadata at all.

## Decision

1. **The original is uploaded untouched and never modified.** Download always returns it, under
   its original filename.
2. **The display copy and the thumbnail are made in the browser** and uploaded beside the
   original (`display.jpg` ≤ 2560 px, `thumb.jpg` ≤ 480 px). Because they come off a canvas they
   are upright and carry no EXIF, so no GPS position is in anything the app displays. HEIC/HEIF
   and TIFF are decoded by lazily loaded decoders. An image the browser cannot decode is saved
   without previews and shows as a typed tile with Download.
3. **Rotation is a stored number**, `orientation` 0/90/180/270, applied by CSS wherever the image
   renders. Rotating in the viewer changes nothing until Save orientation.
4. **Bytes never pass through the API.** The browser uploads to presigned `PUT` URLs and reads
   through presigned `GET` URLs (15 minutes; 60 seconds for a download). A URL is signed only for a
   row the caller's tenant can read, under a key of that tenant.
5. **`files` may make two object-storage calls around a mutation, both outside the
   transaction**: a `HEAD` of each original before Save (a missing or oversized object is refused),
   and a best-effort delete of the objects after a discard commits. §9 says so.
6. **Uploads are two-phase.** `POST /files/uploads` records a pending row; Save turns pending rows
   into files. A pending row is invisible, belongs to its uploader, and is not an audited record.

## Consequences

- No server image processing and no queue. Upload cost is the browser's.
- The display copy is trusted to be a rendering of the original: a staff member with `file:write`
  produces both. The original is always one click away.
- An upload abandoned mid-way (the browser closed) leaves a pending row and objects. Nothing reads
  them; a sweeper is a follow-up.
- The 25 MB limit is checked at the upload request (declared size) and at Save (stored size), not
  by the store while bytes arrive.
- Signed URLs change at every read; the SPA keeps the URL an image was loaded with while it is
  still valid, so a refetch re-downloads nothing.
- The bucket must allow the SPA's origin (CORS) for `PUT` and `GET`.
- An upload URL stays valid for its 15 minutes, Save or not: until it expires the uploader could
  `PUT` other bytes under the same key. It is the uploader only, in their own clinic, and it is not
  audited. Closing it needs a conditional `PUT` (where the store supports one) or a copy to a final
  key at Save; a follow-up.
