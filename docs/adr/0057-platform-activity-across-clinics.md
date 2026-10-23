# ADR-0057: Platform admins see the Activity of every clinic

- Status: Accepted
- Date: 2026-10-23

## Context

While the product is tested with a few clinics, the platform needs to follow what is done in all
of them from one place. Each clinic's Activity screen (ADR-0037) only shows that clinic, and a
platform admin would have to enter clinics one at a time.

## Decision

1. `GET /platform/audit` (`platform:admin`) reads the audit feed — the rows with an area, newest
   first, cursor-paged — of every clinic, narrowed to one clinic (`tenantId`), an area, an actor
   and a start instant. Each row carries its `tenantId`.
2. It reads through `withoutTenant()` (RLS does not apply), from the `audit` module that owns the
   log; the service checks `platform:admin` itself. A partial index on
   `audit_log (occurred_at desc, id desc) where area is not null` (migration 0052) serves it.
3. The admin portal's **Activity** shows it with the clinic's own rows and sentences, plus a Clinic
   column and filter. Names (patients, visits, staff) are looked up in each row's clinic with
   `X-Tenant-Id`, and times are shown in that clinic's time zone. Records are named, not linked:
   they are in a clinic the admin is not inside.
4. A platform admin sees every row there, money rows included (they hold every clinic permission
   but `compensation:*`, ADR-0055).

## Consequences

- The cross-clinic feed is a platform tool for the testing phase; with many clinics, it will want
  a clinic filter by default or a search.
