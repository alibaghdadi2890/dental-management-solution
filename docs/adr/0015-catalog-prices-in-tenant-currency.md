# ADR-0015: Catalog prices are money in the tenant currency; `clinical` reads `tenancy`

- Status: Accepted; amended by ADR-0035 (the currency can't change once the tenant has ledger
  entries)
- Date: 2026-09-27
- Amends: ADR-0002 (dependencies of `clinical`)

## Context

The feature 2 brief gives services a `price` "in the tenant currency". CLAUDE.md §7 requires money
to be `numeric(12,2)` plus a `currency` column. The currency is a tenant setting owned by
`tenancy`, and a tenant can change it (`PATCH /tenant`). ADR-0002 lists only `patients` and
`users` as dependencies of `clinical`.

## Decision

- `procedures` stores `price_amount numeric(12,2)` (≥ 0) and `price_currency char(3)`. The API
  exposes `price: { amount, currency }` (the shared `moneySchema`). Clients send only the amount.
- The currency is stamped from the tenant's current currency, read through
  `TenancyService.currentTenant()`. It is stamped when a row is created and whenever its amount
  changes. An edit that leaves the amount alone keeps the row's currency.
- `clinical` depends on `tenancy`. The edge points down the graph (`tenancy` depends only on
  `audit`), so no cycle is possible.
- Changing the tenant currency converts nothing. Existing rows keep the currency their price was
  set in, and the Catalog screen shows each row's own currency.

## Consequences

- Visits (feature 4) snapshot the price with its currency, so invoices never mix implicit
  currencies.
- Currency conversion, and a bulk "reprice in the new currency" action, are out of scope. They
  would be new decisions.
- CLAUDE.md §4 module map: `clinical` depends on patients, users, tenancy.
