# ADR-0021: Canonical FDI tooth codes; notation and orientation are display settings

- Status: Accepted
- Date: 2026-09-29

## Context

The original feature brief for the clinical workspace (V1) said the chart stores and displays
Universal notation, adult dentition only. Two things changed that:

- Clinics in practice use either FDI (two-digit, ISO 3950) or Universal/National notation, and
  which one a clinic uses is a matter of local habit, not something the product can dictate.
  Storing one notation and displaying another for the rest means every chart-adjacent record
  (diagnoses, treatment plans, tooth status) needs a stable, unambiguous key regardless of which
  notation the tenant reads it in.
- The Claude Design POC (`Dental Clinic POC/clinical-workspace-spec.md`, `ClinicalWorkspace.dc.html`)
  renders all three dentitions (primary, mixed, permanent), not "adult only", and its Settings
  screen exposes a second, independent chart preference: which side of the patient renders on the
  screen's right (`chartOrientation`). Neither of these is optional in the POC, so the spec's
  "Universal, adult dentition only" was out of date (see feature 4a design, Goal).

A chart cell also needs to render sensibly in RTL locales (Arabic). Mirroring the whole chart
layout when the UI direction flips would silently swap which physical tooth a click hits.

## Decision

- **The canonical stored value is FDI two-digit text** (`ToothCode`, `packages/contracts/src/tooth.ts`):
  permanent `11–18, 21–28, 31–38, 41–48`, primary `51–55, 61–65, 71–75, 81–85`. Every table that
  references a tooth (`patient_diagnoses`, `treatment_plans`, `visit_services`, `tooth_status`)
  stores this code and nothing else. Universal notation is derived on the fly (`toUniversal`,
  `parseTooth`) and never stored.
- **Three tenant-level chart settings, all display-only, none of them changes what is stored or
  computed:**
  - `toothNotation` (`fdi` default, or `universal`) — which labels the chart, tooth picker and
    tooth history show. Changing it re-labels every tooth reference in the UI; it never rewrites
    a stored code.
  - `chartOrientation` (`patient_right_on_right` default, as in the POC, or `patient_right_on_left`)
    — which side of the patient renders on the screen's right. It flips the column order, the R/L
    markers, and the mesial/distal side of each tooth's surface cells together
    (`archColumns`, `mesialLeft`, `surfaceCells`). Mesial is always resolved toward the midline
    from the code's quadrant and position; it is never mirrored independently of the orientation
    setting.
  - `chartMode` (`surface` default, or `simple`) — how much per-surface detail the chart renders.
    Simple mode changes rendering only; the derived chart state (`packages/contracts/src/chart.ts`)
    is computed identically in both modes and never mutates data.
- **The chart is never mirrored by locale.** It renders `dir="ltr"` inside RTL layouts
  unconditionally; `chartOrientation` is the only setting that changes left/right. The chart's
  text, labels and legend still follow the locale's language and direction rules — only the tooth
  grid itself is pinned to `ltr`.
- The three settings live on `tenants` (`tenancy` module) as Postgres enums whose values are the
  same `TOOTH_NOTATIONS` / `CHART_ORIENTATIONS` / `CHART_MODES` consts `tooth.ts` exports, so the
  contract and the database can never drift. `tenantSchema`, `tenantSettingsPatchSchema` and the
  session's `tenant` object all carry the three fields; `PATCH /tenant` (`tenant:write`) is the
  only way to change them, and every existing tenant is backfilled with the defaults in the same
  migration that adds the columns.

## Consequences

- Every module that charts, diagnoses or plans against a tooth works with one unambiguous key
  (FDI text) regardless of tenant preference, so cross-tenant support, exports and the agent
  toolbox (phase 2) never need to know which notation a given tenant prefers.
- A tenant can change `toothNotation` or `chartOrientation` at any time with no data migration:
  every past diagnosis, plan and chart mark re-labels and re-lays-out immediately, because nothing
  about the setting is baked into a stored row.
- `chartMode` has no server-side effect beyond being read back in the session; the derivation in
  `chart.ts` runs once and both chart renderings (surface, simple) read from the same result. If a
  future chart property does depend on `chartMode`, that logic belongs in the derivation, not in a
  second stored value.
- RTL readiness (CLAUDE.md §13) is satisfied by keeping the chart's internal direction pinned,
  never by mirroring geometry the tenant didn't ask to mirror; `chartOrientation` remains the only
  lever for that.
