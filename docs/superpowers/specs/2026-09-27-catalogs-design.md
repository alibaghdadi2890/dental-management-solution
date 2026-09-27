# Feature 2 — Service and diagnosis catalogs — design

Date: 2026-09-27 · Status: draft for review

## Goal

Each clinic keeps its own catalog of services (what it charges for) and diagnoses (what dentists
record), edited on the POC's Catalog screen (`Dental Clinic POC/Catalog.dc.html`, README §Catalog).
Every tenant starts with the POC's default catalog. The catalog is what the visit drawer (feature 4)
and pricing (feature 6) read. Everything is audited, tenant-isolated, tested and documented.

Out of scope: visits, treatment plans, price history, per-branch prices, catalog import/export,
CDT/ICD code mapping, currency conversion.

## Decisions

The brief's C1–C8 stand. Decisions taken while designing (✓ = confirmed by the product owner):

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                     | ADR  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| K1✓ | **Other modules may consume `provisioning`'s events but never call it.** `clinical` subscribes to `TenantProvisioned` and seeds the default catalog after commit as a `system` actor inside the new tenant. No BullMQ job: seeding is fast and idempotent, and the "Seed default catalog" button recovers from a crash between commit and handler.                           | 0014 |
| K2✓ | **Service prices are money per CLAUDE.md §7**: `price_amount numeric(12,2)` + `price_currency char(3)`. The currency is the tenant's, stamped on create and whenever the amount changes. `clinical` gains a read edge to `tenancy` (`TenancyService.currentTenant()`). A tenant currency change converts nothing: existing rows keep their currency, which the screen shows. | 0015 |
| K3  | `procedure:read`/`procedure:write` become **`catalog:read`/`catalog:write`** in the permission catalog, role seeds and a data migration that rewrites existing `role_permissions` rows. Otherwise tenants from feature 1 would lose the permission, because unknown permission text grants nothing.                                                                          | —    |
| K4  | Codes are trimmed and **upper-cased** by the contract (the POC upper-cases while typing). They are unique per tenant and per catalog among non-deleted rows (partial unique index on `lower(code)`), so a deleted code can be reused.                                                                                                                                        | —    |
| K5  | Blank code/name fail request validation: **400** `validation_failed` with the same row paths (`items.3.name`), consistent with every other route. Duplicate codes need the stored catalog and fail in the domain with **422** `validation_failed` and row paths. The UI checks both rules before sending, so neither status is normally hit.                                 | —    |
| K6  | Category is **optional** free text (≤ 40). Rows without one appear only under "All".                                                                                                                                                                                                                                                                                         | —    |
| K7  | Delete and "Mark inactive" apply **immediately** (C6) and are merged into the open draft, so other unsaved edits survive. Deleting a row that only exists in the draft just drops it, as in the POC.                                                                                                                                                                         | —    |
| K8  | Default "frequent" flags come from the workspace spec: services `CMP`, `CGIC`, `EXT`, `ZIR`; diagnoses `DX-CAR`, `DX-DEEP`, `DX-SENS`, `DX-GIN`. The POC's active flags are kept (`XRY` and `DX-BRUX` are seeded inactive).                                                                                                                                                  | —    |
| K9  | The read-only note covers both tabs: "The catalog is managed by the clinic owner. You can view it here." The POC's note ("managed by dentists", diagnoses only) predates C4.                                                                                                                                                                                                 | —    |

## Module graph changes

```
clinical   patients, users, tenancy (new: tenant currency)   procedures, diagnoses
           consumes TenantProvisioned (provisioning, events only — K1)
```

`clinical` also depends on `audit`, like every module that mutates. Neither `patients` nor `users`
is used yet. CLAUDE.md §4 (clinical row, the provisioning rule) and ADR-0002/0009 are amended by
ADR-0014/0015.

## Data model (`clinical`)

All ids are uuid v7 from the application; `created_at`/`updated_at` on both tables;
`tenantIdColumn()` + `tenantIsolationPolicy()` + an index on `tenant_id`; soft delete via
`deleted_at`.

| Table        | Columns                                                                                                                                                                                                 | Constraints                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `procedures` | `id`, `tenant_id`, `code`, `name`, `category?`, `charge_unit` (`charge_unit` enum: `per_tooth`, `per_jaw`), `price_amount` numeric(12,2), `price_currency` char(3), `frequent`, `active`, `deleted_at?` | Tenant RLS. Unique `(tenant_id, lower(code)) where deleted_at is null`. Check `price_amount >= 0`. |
| `diagnoses`  | `id`, `tenant_id`, `code`, `name`, `category?`, `frequent`, `active`, `deleted_at?`                                                                                                                     | Tenant RLS. Unique `(tenant_id, lower(code)) where deleted_at is null`.                            |

`charge_unit` is a Postgres enum because it is a stable, non-tenant-extendable value set;
`category` is text + Zod because tenants extend it (CLAUDE.md §7). Lists are ordered by
`created_at, id`, so seeded rows keep the POC order and new rows follow.

Migration `0006_catalog_permissions.sql` (custom, written by hand) renames the permissions in
`role_permissions`. It runs as the schema owner, so it covers every tenant (RLS is not forced).
`0007_catalog.sql` (generated) adds the enum and both tables.

## Contracts (`packages/contracts/src/catalog.ts`)

- `chargeUnitSchema` = `per_tooth | per_jaw`; `catalogCodeSchema` (trim, 1–20, upper-cased);
  `catalogCategorySchema` = `optionalText(40)`; `nonNegativeAmountSchema` (decimal string ≥ 0).
- `serviceItemSchema` `{ id, code, name, category: string|null, chargeUnit, price: Money, frequent, active }`.
- `diagnosisItemSchema` `{ id, code, name, category, frequent, active }`.
- `serviceItemInputSchema` `{ id?, code, name, category, chargeUnit, price: amount, frequent, active }`
  (the currency is never sent; the server stamps it). `diagnosisItemInputSchema` likewise.
- `serviceBatchSchema` / `diagnosisBatchSchema` `{ items: 1–500 }`, with no id repeated.
- `catalogSeedResultSchema` `{ services: number, diagnoses: number }` (rows created).
- `permissions.ts`: `catalog:read`, `catalog:write` replace `procedure:read`, `procedure:write`.

## Backend (`modules/clinical`)

```
clinical/
  domain/        default-catalog.ts (POC template), catalog-batch.ts (duplicate codes), catalog-errors.ts
  persistence/   schema.ts, procedures.repository.ts, diagnoses.repository.ts
  application/   catalog.service.ts, catalog-seeding.subscriber.ts
  http/          catalog.controller.ts
  events/        catalog-changed.ts
```

### Platform addition

`platform/kernel/validation-failed.error.ts`: `ValidationFailedError extends DomainError`
(`code = 'validation_failed'`, `kind = 'invalid'` → 422) that carries `issues: { path, code,
message }[]`. `toProblemDetails` renders them as `errors`, which the problem contract already
defines. Domain code can then report row-level failures without knowing about HTTP.

### `CatalogService`

| Method                                              | Permission      | Notes                                                                                                                                                 |
| --------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listServices()` / `listDiagnoses()`                | `catalog:read`  | All non-deleted rows, active and inactive (the screen filters). Small reference lists: no pagination (CLAUDE.md §12).                                 |
| `saveServices(batch)` / `saveDiagnoses(batch)`      | `catalog:write` | One transaction. Unknown or deleted id → 404 `catalog.not_found`. Duplicate codes → 422. Per-row audit. Returns the full list.                        |
| `deleteService(id)` / `deleteDiagnosis(id)`         | `catalog:write` | `isInUse(id)` → 409 `catalog.in_use`; otherwise soft delete. Audited.                                                                                 |
| `deactivateService(id)` / `deactivateDiagnosis(id)` | `catalog:write` | "Mark inactive" from the delete dialog. Audited. Returns the row.                                                                                     |
| `seedDefaultCatalog()`                              | `catalog:write` | Only when both catalogs have no non-deleted rows; inserts with `on conflict do nothing` so concurrent calls cannot duplicate. Returns counts created. |
| `isInUse(id)`                                       | —               | Always `false` until visits exist (feature 4 fills it in).                                                                                            |
| `listActiveServices()` / `listActiveDiagnoses()`    | —               | Exported (C8). Not permission-gated: building blocks for services that guard their own use, like `TenancyService.activeBranches`.                     |
| `getService(id)` / `getDiagnosis(id)`               | —               | Exported (C8). A non-deleted row, active or not; otherwise 404 `catalog.not_found`.                                                                   |

Batch rules (pure, `domain/catalog-batch.ts`): the state _after_ the batch is checked, so a batch
may swap codes between rows. Every changed row whose code collides with another row
(case-insensitive) gets an issue `{ path: 'items.<i>.code', code: 'duplicate', message: 'Code
EXT is already used by "Extraction"' }`. A unique-index violation that slips past (a concurrent
save) is mapped to the same error, with the path `items`.

Currency (K2): a created row takes the tenant's currency. An updated row keeps its currency unless
`price` changed, in which case it takes the tenant's current one.

Audit: one entry per row with `before`/`after`, with actions `catalog.service.create|update|delete|deactivate`
and `catalog.diagnosis.*`, and `resource_type` `procedure` / `diagnosis`. Every mutation
publishes `CatalogChanged { kind: 'service' | 'diagnosis', ids }`, which the generic subscriber
also records.

### Seeding on provisioning (K1)

`CatalogSeedingSubscriber` handles `TenantProvisioned`. It rebuilds the context from the event
(`actorKind: 'system'`, the event's tenant and request id), calls `seedDefaultCatalog()`, and
catches and logs its own failure (tenant id only). An exception must not stop the event from
reaching the audit subscriber that runs after it.

### Routes

| Route                                    | Access          |
| ---------------------------------------- | --------------- |
| `GET /catalog/services`                  | `catalog:read`  |
| `PUT /catalog/services`                  | `catalog:write` |
| `DELETE /catalog/services/:id`           | `catalog:write` |
| `POST /catalog/services/:id/deactivate`  | `catalog:write` |
| `GET /catalog/diagnoses`                 | `catalog:read`  |
| `PUT /catalog/diagnoses`                 | `catalog:write` |
| `DELETE /catalog/diagnoses/:id`          | `catalog:write` |
| `POST /catalog/diagnoses/:id/deactivate` | `catalog:write` |
| `POST /catalog/seed-default`             | `catalog:write` |

A platform admin reaches these with `X-Tenant-Id` (ADR-0008) and holds every permission there.

## Frontend

### Structure

```
routes/_app/catalog.tsx                      ?tab=services|diagnoses (UI state in the URL)
features/clinical/catalog/
  catalog-api.ts                             queries, mutations, keys
  catalog-draft.ts (+ spec)                  pure draft model: edit, add, drop, changes, row errors
  catalog-page.tsx                           header, tabs, filters, table, save bar, dialogs
  catalog-row.tsx                            one inline-editable row
  frequent-toggle.tsx                        the star
features/platform/tenant-detail/overview-tab.tsx   catalog cards + "Seed default catalog"
shell/nav-items.ts                           Catalog visible with catalog:read
locales/{en,ar,fr}/catalog.json
```

### Catalog screen (pixel port of `Catalog.dc.html`)

- Header "Catalog" + subtitle. "Add service" / "Add diagnosis" (outline 36px) only with
  `catalog:write`.
- Tabs Services · Diagnoses with count chips (the `ViewTabs` primitive).
- Read-only note (K9) when the user lacks `catalog:write`.
- Filter bar: search (name or code), category pills, and a "Show inactive" checkbox (on by default,
  as in the POC). The pills are All plus the distinct categories of the tab's draft rows, in order of
  first appearance, so a newly typed category becomes a pill at once. The active pill is `#1b1a1f`.
  Pills are 30px, radius 15px.
- Grid (min width 800px):
  - services `96px minmax(200px,1fr) 44px 140px 112px 104px 52px 64px`: Code · Name · ★ · Category · Charged · Price · Active · actions
  - diagnoses `112px minmax(220px,1fr) 44px 150px 52px 64px`
- Row: 50px min, 32px cells with `#e3ded4` borders (transparent when read-only). Code is Mono 500
  12.5px, upper-cased while typing. The name has a `#9b2c2c` border when blank and errors are
  shown. Category is an input with a `<datalist>` of the tab's categories. Charged is a select
  (Per tooth / Per jaw). Price is right-aligned Mono with the currency symbol of the row, or the
  tenant's for new rows (`Intl` narrow symbol); input keeps digits and one dot, at most two decimals.
  Active is the 34×20 switch. Dirty and new rows are `#fffdf8` with the 7px `#b8893a` dot.
  Inactive rows have opacity .6 as in the POC, and their name is struck through (the brief's
  acceptance asks for "struck out", which the POC does not show).
- **Frequent** (design gap, from the brief): a 16px outline star (`#6f6b64` stroke), filled
  `#3b3f8f` when on; `aria-pressed`, label "Frequently used". It is static when read-only.
- Row-level errors: a duplicate code (client-side check, or the 422's `errors` mapped back to rows
  by index) marks the code cell and shows the message under the row (11.5px `#9b2c2c`).
- Save bar: "N unsaved changes" (both tabs counted, as in the POC); the error is "N rows missing a
  code or name" or "N rows with a duplicate code", and Save stays disabled while either is present.
  Discard asks "Discard all changes?" / "N edits will be lost." Save sends one `PUT` per tab that
  has changes and toasts "Saved N catalog changes". If one tab fails, the other tab's saved state
  is kept.
- Delete (write users): a new row is dropped. A saved row asks "Delete {name}?" / "It is removed
  from the catalog right away." (danger) → `DELETE`. On 409 `catalog.in_use` the POC dialog
  follows: "{name} is used on visits" / "Deleting it would break those visit records. Mark it
  inactive instead — it stays on past visits but can't be added to new ones." with "Mark inactive"
  → `POST …/deactivate`. Both merge into the draft (K7).
- Unsaved-changes guard: while dirty, route changes ask "Discard unsaved changes?" ("Discard and
  leave" / "Keep editing") via the router's blocker, and `beforeunload` is set.
- States: loading skeleton rows at the column widths; error "Couldn't load the catalog" / "The
  visit workspace keeps using the last saved catalog." + request id + Try again; empty "The catalog
  is empty" / "Add the services you charge for so dentists can pick them during a visit." (the
  diagnoses tab gets its own body); no results "Nothing matches" / "Try another category or clear
  the search." + "Clear search and filters".
- New row: at the top, category = the selected pill (else blank), code blank (services) or `DX-`
  (diagnoses), price `0`, per tooth, active, not frequent; the search is cleared.

### Admin tenant Overview

Two new cards, "Services" and "Diagnoses", with counts and "N active of M". While both are 0
(loaded), a card spans the grid: "This clinic has no services or diagnoses yet." with the primary
button **Seed default catalog** → `POST /catalog/seed-default` (explicit `X-Tenant-Id`) → toast
"Default catalog added: 12 services, 14 diagnoses" → the queries refresh and the card disappears.

## Testing

- **Unit (api, `domain/`)**: default template matches the POC (12 services, 14 diagnoses, prices,
  units, active and frequent flags); duplicate-code check (case-insensitive, swaps allowed, existing
  vs changed rows, path indexes); `ValidationFailedError` → 422 with `errors`.
- **Unit (contracts)**: code upper-cases and trims; negative, 3-decimal and blank prices rejected;
  batch rejects repeated ids and empty lists; catalog permissions present and `procedure:*` gone.
- **Unit (roles)**: role matrix uses `catalog:*` (owner writes; dentist, assistant, frontdesk read).
- **Integration** (Testcontainers):
  - provisioning seeds both catalogs, with `system` audit rows;
  - `seed-default` is a no-op when rows exist and seeds a tenant emptied by deletes;
  - batch create/update, stamped currency, swap codes;
  - duplicate → 422 with `items.N.code`;
  - unknown id → 404;
  - delete soft-deletes and frees the code;
  - `isInUse` is consulted: a test double returning true gives 409 `catalog.in_use` and deletes nothing;
  - deactivate;
  - audit before/after per row and a `CatalogChanged` entry;
  - frontdesk reads, and gets 403 on `PUT`, `DELETE`, deactivate and seed;
  - the migration renames existing `procedure:*` grants.
- **Isolation suite**: A's owner lists only A's rows. B's ids give 404 on `PUT`, `DELETE` and
  deactivate, and B's rows are unchanged. RLS is enabled on `procedures` and `diagnoses`.
- **Web unit**: draft model (dirty counting across tabs, discard, missing code/name, duplicate
  codes, pills from categories, delete merge keeps other edits, 422 error mapping); nav shows
  Catalog with `catalog:read`; read-only rendering (no inputs editable, note shown).
- **Playwright**: the platform admin provisions a clinic and signs in as the owner. The owner adds
  a service with a new category and saves, then filters by that category. They mark the service
  inactive with the switch and save, turn "Show inactive" off and on, and see it struck out. The
  existing identity flow checks that the front desk user sees the read-only catalog.

## Documentation

- ADR-0014: consuming `provisioning` events (amends 0009).
- ADR-0015: catalog prices in the tenant currency, `clinical → tenancy` (amends 0002).
- `docs/adr/README.md` index.
- `docs/modules/clinical.md`: status, owned tables, public API, events, permissions.
- `docs/modules/roles.md`: matrix.
- CLAUDE.md:
  - §4: clinical row, provisioning rule.
  - §6: permission catalog note on the rename.
