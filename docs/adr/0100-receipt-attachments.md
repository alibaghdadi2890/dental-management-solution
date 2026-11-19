# ADR-0100: Receipt attachments

- Status: Accepted
- Date: 2026-11-19
- Extends: ADR-0039, ADR-0041

## Context

Whoever receives photographs the supplier's invoice; only those who see inventory money may open
it. The files are not patient files, and the bytes must never pass through the API.

## Decision

1. Up to five photos (JPEG, PNG, WebP, HEIC/HEIF) or PDFs per receipt, 25 MB each, in
   `inventory_receipt_files`, attached with `inventory:write`.
2. The patient files' mechanics: a presigned `PUT` to `tenants/<t>/inventory/uploads/<id>`; a
   seal that copies inside the store to `tenants/<t>/inventory/receipts/<receipt>/<id>` and checks
   the copy (there, not empty, within the limit, the first bytes of its type); a 5-minute
   presigned `GET` to open it (`inventory:money_read`); removal with `inventory:money_manage`.
   Outside the transaction, deletes best effort. No previews.
3. The byte check (`contentMatches`) moves from `files/domain` to `platform/storage/content-check`:
   it is pure and knows nothing of patients. Both modules import it; nothing else moves.

## Consequences

- A pending upload whose browser closed stays behind, as for patient files; a sweeper is later
  work.
