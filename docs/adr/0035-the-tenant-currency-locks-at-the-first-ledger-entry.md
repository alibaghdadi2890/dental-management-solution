# ADR-0035: The tenant currency locks at the first ledger entry

- Status: Accepted
- Date: 2026-10-06
- Amends: ADR-0015 (a currency change converts nothing — and is now refused once there is money)

## Context

Every ledger entry is stamped with the tenant currency of the moment (ADR-0015), and nothing is
converted when the currency changes. A clinic that changed currency after recording money ended up
with balances in two currencies, and every figure that reports "the" balance silently left the
older one out (a known gap in `docs/modules/billing.md`).

Feature 7 (H6) decides that a tenant's currency can be changed only while the tenant has no money
recorded. `tenancy` owns the setting; `billing` owns the ledger and already depends on `tenancy`,
so `tenancy` cannot ask `billing` whether an entry exists (CLAUDE.md §4 rule 4).

We considered:

- **A `currency_locked_at` column on `tenants`, set by `billing` on the first entry.** `billing`
  would call a `tenancy` service only to trigger a side effect (rule 3), and every ledger write
  would touch the tenant row.
- **Checking in the SPA only.** The decision asks for the API to refuse a bypass.

## Decision

1. **`tenancy` announces a currency change inside its transaction.** `updateSettings` publishes
   `TenantCurrencyChanged { from, to }` when the stored currency really changes.
2. **`billing` refuses it.** An in-transaction handler throws `TenantCurrencyLockedError` (422
   `tenant.currency_locked`) when any ledger entry exists. The throw rolls the settings change
   back — the mechanism of ADR-0026.
3. **`GET /billing/currency-lock`** (`tenant:read`) answers `{ locked, currency }` for the admin
   Settings tab, which disables the select and says why. The veto is the guarantee; the read is
   for the screen.
4. Entries are never deleted, so a locked tenant stays locked. Changing the currency of a clinic
   with money is a support operation outside the product.

## Consequences

- No new dependency edge: `tenancy` knows nothing of `billing`.
- A platform admin is refused like anyone else: the rule is about the data, not the actor.
- A currency change that races the clinic's very first ledger entry can commit together with it;
  the entry keeps the old currency and shows as a second-currency balance, as before this ADR. It
  needs a platform admin to change the currency in the same instant a clinic records its first
  money, and was not worth a lock on every ledger write.
- A live visit started before a currency change still charges in the currency stamped at its
  start (unchanged).
- Tenants that already hold balances in two currencies keep them; the lock stops new ones.
