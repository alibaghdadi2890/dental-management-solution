# ADR-0049: A diagnosis cites what it was seen on; `files` vetoes the link in the transaction

- Status: Accepted
- Date: 2026-10-10

## Context

An examination starts from the evidence: the X-rays and photos. Feature 10 lets a diagnosis say
what it was seen on — one of the patient's images, or the clinical exam — and lets the image's
viewer list the diagnoses that cite it.

The diagnosis is `clinical`'s row. The image is `files`' row. `files` already depends on
`clinical`; the reverse edge is not allowed (CLAUDE.md §4). So `clinical` cannot check that a file
id is a live file of the same patient, and without that check a diagnosis could cite another
patient's X-ray.

## Decision

1. **A diagnosis stores what it was seen on**: `patient_diagnoses.seen_on` (`clinical_exam` or
   `image`, nullable for "not said") and `seen_on_file_id`, set if and only if `seen_on` is
   `image`. The file id is a plain uuid in `clinical`'s table, with no foreign key into `files`.
2. **`files` checks the link inside `clinical`'s transaction.** Citing an image publishes
   `DiagnosisEvidenceCited { recordId, patientId, fileId }`. `files` handles it with
   `@OnDomainEventInTransaction` and throws 422 `record.evidence_invalid` unless the file is a
   saved, unarchived image of that patient. The throw rolls the diagnosis back. This is the veto
   pattern of ADR-0026.
3. **An archived file stays cited.** The check runs when the link is made. Archiving later does
   not clear it: the diagnosis was seen on that image, and the image is still in the record.
4. **`files` does not store the link.** `ChartService.fileCitations(patientId)` answers, per
   file id, the diagnoses that cite it. The SPA joins that read with the files it shows.
5. **Who may set it:** in a visit, `visit:write`, on any diagnosis of the visit's patient; on the
   patient record, `chart:write`. It is audited as `diagnosis_record.seen_on`.

## Consequences

- A patient merge moves the diagnoses and the files of the dropped record to the kept one in the
  same transaction, so a citation still names a file of the same patient afterwards.
- A file that was never saved (a pending upload) cannot be cited.
- The link is one image per diagnosis. A diagnosis seen on two images cites one of them; the
  note can name the other.
- If `files` is ever split from the monolith, this check becomes a synchronous call or an
  eventual one, and the ADR needs revisiting.
