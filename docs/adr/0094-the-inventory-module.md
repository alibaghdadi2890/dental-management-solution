# ADR-0094: The `inventory` module and its edges

- Status: Accepted
- Date: 2026-11-19

## Context

Feature 20a adds what the clinic stocks: items, receiving, taking out, counting, suppliers and
their accounts. It touches Expenses (supplier payments), the import APIs, the dashboards and
Today, and must not grow any existing module.

## Decision

1. A new module, `inventory`, owns categories, items, an item's state per branch, suppliers,
   receipts and their counter, batches, movements and their batch shares, counts and their
   lines, supplier payments and adjustments, receipt attachments and its settings.
2. It depends on `tenancy` (currency, time zone, branches, locale), `users` (names) and `audit`
   only. It consumes `provisioning`'s `TenantProvisioned` after the commit to seed its categories
   (ADR-0014) and vetoes `tenancy`'s `TenantCurrencyChanged` once inventory money exists.
3. `expenses` imports its payment events (the mirror, ADR-0098), as it does for `labs`. `imports`
   gains an edge to it (items and opening stock); `dashboards` gains one (the Stock card, the
   Suppliers line, three Needs attention lines). Nothing else imports it.
4. The categories follow the expense categories' rules: the twelve predefined ones are translated
   by key and only turned off and on; the clinic's own are named, renamed, turned off, and deleted
   while unused. Migration 0062 seeds them for every existing clinic.

## Consequences

- The module map gains a row; `imports`, `dashboards` and `expenses` record the new edges.
- No existing table changes except the `expenses` source check and mirror index (ADR-0098).
