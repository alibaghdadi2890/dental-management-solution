# `clinical` module

**Status:** partly implemented. The service and diagnosis catalogs are done (feature 2); visits
and treatment plans are planned (feature 4).

## Purpose

Clinical work on a patient:

- **Visits** (planned): encounters with practitioner, date, services performed with
  tooth/surfaces, notes, status, and amend/void with a reason.
- **The per-tenant catalogs**: services (what the clinic charges for) and diagnoses (what dentists
  record).
- **Treatment plans** (planned): planned procedures and charting linked to visits.

Tooth numbering is Universal (1–32, A–T), per the POC. This module was renamed from `treatments`
(ADR-0001) and owns the catalogs (ADR-0002).

### Catalogs

- Every tenant starts with the POC's default template (`domain/default-catalog.ts`: 12 services
  with prices, 14 diagnoses, the workspace spec's "Frequently used" rows). It is seeded
  on `TenantProvisioned` by a system task (ADR-0014) and by the idempotent
  `POST /catalog/seed-default`, which seeds only while both catalogs are empty. Seeded rows are
  ordinary rows.
- Codes are upper-cased and unique per tenant and catalog among live rows, case-insensitively. A
  deleted code can be reused. The batch rule (`domain/catalog-batch.ts`) checks the state after
  the batch, so rows may swap codes.
- Service prices are money in the tenant currency at the time they were set (ADR-0015).
- Categories are free text; the Catalog screen's filter pills are the distinct values.
- A row that a visit refers to cannot be deleted, only deactivated (`isInUse`, which returns
  false until visits exist). Other rows are soft-deleted.

## Owns

- `procedures`: the service catalog. Tenant RLS. `code`, `name`, `category?`, `charge_unit`
  (enum `per_tooth | per_jaw`), `price_amount numeric(12,2) ≥ 0`, `price_currency char(3)`,
  `frequent`, `active`, `deleted_at?`. Unique `(tenant_id, lower(code)) where deleted_at is null`.
- `diagnoses`: the diagnosis catalog. Tenant RLS. `code`, `name`, `category?`, `frequent`,
  `active`, `deleted_at?`. Same unique rule.
- Planned: `visits`, `visit_services`, `treatment_plans`, `planned_procedures`.

## Public API (`index.ts`)

`ClinicalModule`, `CatalogService`, `CatalogItemNotFoundError`, `CatalogItemInUseError`, and the
`CatalogChanged` event.

`CatalogService`:

| Method                                              | Access          | Notes                                                                                           |
| --------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `listServices()` / `listDiagnoses()`                | `catalog:read`  | Live rows, active and inactive, oldest first.                                                   |
| `saveServices(batch)` / `saveDiagnoses(batch)`      | `catalog:write` | One transaction. Duplicate code → 422 `validation_failed` (`items.<i>.code`); unknown id → 404. |
| `deleteService(id)` / `deleteDiagnosis(id)`         | `catalog:write` | In use → 409 `catalog.in_use`; otherwise soft delete.                                           |
| `deactivateService(id)` / `deactivateDiagnosis(id)` | `catalog:write` | "Mark inactive".                                                                                |
| `seedDefaultCatalog()`                              | `catalog:write` | `{ services, diagnoses }` rows created; `{0, 0}` when a catalog exists.                         |
| `listActiveServices()` / `listActiveDiagnoses()`    | caller guards   | For the visit drawer (feature 4) and pricing (feature 6).                                       |
| `getService(id)` / `getDiagnosis(id)`               | caller guards   | A live row, active or not; else 404 `catalog.not_found`.                                        |
| `isInUse(id)`                                       | —               | Always false until feature 4.                                                                   |

Every write is audited per row with before/after (`catalog.service.create|update|delete|deactivate`,
`catalog.diagnosis.*`; resource types `procedure` and `diagnosis`).

## HTTP

| Route                                               | Access          |
| --------------------------------------------------- | --------------- |
| `GET /catalog/services`, `GET /catalog/diagnoses`   | `catalog:read`  |
| `PUT /catalog/services`, `PUT /catalog/diagnoses`   | `catalog:write` |
| `DELETE /catalog/{services,diagnoses}/:id`          | `catalog:write` |
| `POST /catalog/{services,diagnoses}/:id/deactivate` | `catalog:write` |
| `POST /catalog/seed-default`                        | `catalog:write` |

## Events

- Emits:
  - `CatalogChanged { kind: 'service' | 'diagnosis', ids }`.
  - Planned: `VisitStarted`, `VisitCompleted`, `VisitAmended`, `VisitVoided`.
- Consumes: `TenantProvisioned` (provisioning, event only — ADR-0014). It seeds the default
  catalog.

## Depends on

- `tenancy`: the tenant currency (ADR-0015).
- `audit`.
- Planned: `patients`, `users`.

## Permissions

- `visit:read`, `visit:write`.
- `catalog:read`: every clinic role.
- `catalog:write`: owner. A platform admin acting in the tenant also has it.

The catalog permissions cover both the service and the diagnosis catalog.
