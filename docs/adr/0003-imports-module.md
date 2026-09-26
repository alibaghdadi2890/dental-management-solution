# ADR-0003: `imports` module orchestrates data imports

- Status: Accepted
- Date: 2026-09-26

## Context

Clinics must import existing patients with service history. Module rule 1 forbids writing another
module's tables, and the upload → map → validate → preview → commit machinery would otherwise be
duplicated in `patients` and `clinical`.

## Decision

A new `imports` module owns import jobs and staged rows. Input is our CSV/XLSX template (patients,
and visits + services linked by an external patient id) with column mapping for a clinic's own
export. Commit runs as an idempotent BullMQ job that calls `PatientsService` and the clinical
`VisitsService` through their `index.ts`. `imports` depends on `patients`, `clinical` and
`tenancy`; nothing depends on `imports`.

## Consequences

- New dependency edges `imports → patients` and `imports → clinical`.
- Source-specific adapters (other practice-management exports) can be added behind the parser.
- The CSV mapping screen is not in the design POC yet ("Not yet designed"); it needs design input.
