# ADR-0018: Offset paging for the patients list

- Status: Accepted
- Date: 2026-09-27
- Amends: CLAUDE.md §12 (pagination)

## Context

CLAUDE.md §12 says that lists that grow use cursor pagination, and that offset pagination is only
for small reference lists. The patients list grows, but the POC's pager (`Patients.dc.html`)
shows "Showing 11–20 of 54", a rows-per-page choice (10/25/50) and numbered page buttons. A
cursor gives neither a total nor random access to page N. The list can also be sorted by name,
age, dentist, recent update and (through `billing`) balance, and each sort would need its own
cursor encoding.

## Decision

- `GET /patients` (and `GET /billing/patients`, which returns the same shape) takes `page` (≥ 1)
  and `size` (10, 25 or 50) and returns `{ items, total, page, size }`
  (`offsetPageSchema` in `@dcm/contracts`).
- The total comes from `count(*) over ()` in the same query. A page past the end runs a second
  count, so it still reports the real total.
- Every sort ends with `name_key, id` as tie-breakers, so pages are stable while the data doesn't
  change.
- This exception covers the patients list only. Appointments, audit and other growing lists stay
  on cursors.

## Consequences

- Patients per tenant are bounded: thousands, not millions. At that size an offset scan and a
  windowed count are cheap. A tenant that grows far beyond this would need a new decision, for
  example keyset paging with an estimated total.
- A write between two page requests can shift rows across a page boundary, so a row may appear
  twice or be skipped. This is acceptable for a UI list that refetches on change.
- Export (`billing`) walks the same search in pages of 500. It has the same shift risk, which is
  acceptable for a point-in-time CSV.
