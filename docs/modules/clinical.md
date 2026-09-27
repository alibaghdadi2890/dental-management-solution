# `clinical` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

Clinical work on a patient: visits (encounters with practitioner, date, services performed with tooth/surfaces, notes, status and amend/void with reason), the per-tenant procedure/service catalog (code, name, category, charged per tooth/jaw, price, active), treatment plans, planned procedures and charting linked to visits. Tooth numbering is Universal (1–32, A–T), per the POC. Renamed from `treatments` (ADR-0001); owns the catalog (ADR-0002).

## Owns

`visits`, `visit_services`, `procedures` (catalog), `treatment_plans`, `planned_procedures` (planned).

## Public API (`index.ts`)

`ClinicalModule`. Planned: `VisitsService` (create, complete, amend, void, list, import historical visits for `imports`), `CatalogService`.

## Events

- Emits: `VisitStarted`, `VisitCompleted`, `VisitAmended`, `VisitVoided`, `ProcedureCatalogChanged` (planned).
- Consumes: —

## Depends on

patients, users

## Permissions

`visit:read`, `visit:write`, `catalog:read` (every clinic role), `catalog:write` (owner). The
catalog permissions cover both the service and the diagnosis catalog.
