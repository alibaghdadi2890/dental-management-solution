# ADR-0021: Canonical FDI codes; chart settings are display-only

- Status: Accepted
- Date: 2026-09-29

## Context

The Claude Design POC's own spec document (`Dental Clinic POC/clinical-workspace-spec.md`)
describes the chart as "Universal (1–32), adult dentition only" — but the brief that governs this
feature already decided otherwise. **V1** is the decision to store the canonical tooth code as
FDI text, leaving the notation a tenant reads it in as a separate display preference. **V9** turns
that preference into an actual tenant setting (`toothNotation`), and adds `chartMode` (surface vs.
simple detail) alongside it. **W3** adds a third setting, `chartOrientation` — which side of the
patient renders on the screen's right — because the POC's own Settings screen exposes it
independently of notation and detail, and it needs to flip more than labels: the column order, the
R/L markers, the mesial/distal side of each surface cell, and the ←/→ keyboard order all move
together. **W17** pins the chart to `dir="ltr"` inside RTL layouts, so `chartOrientation` — never
the locale — is the only thing that changes which side is left and which is right.

The POC (`ClinicalWorkspace.dc.html`) itself is consistent with V1/V9/W3, not with its own spec
document: its Settings screen exposes chart detail and orientation as two independent
preferences, and the chart renders primary, mixed and permanent dentition by the patient's age —
not "adult only" (see feature 4a design, Goal).

One more consequence of V1: `tooth_status` (a per-patient record of which dentition currently
occupies a chart position) stores a **column position** — the permanent FDI code of that column,
e.g. `14` — not a reference to whichever tooth, primary or permanent, happens to occupy it today.
The occupant is a separate field (`present`); the position never changes when it does.

A chart cell also needs to render sensibly in RTL locales (Arabic). Mirroring the whole chart
layout when the UI direction flips would silently swap which physical tooth a click hits — which
is exactly what W17 rules out.

## Decision

- **The canonical stored value is FDI two-digit text** (`ToothCode`, `packages/contracts/src/tooth.ts`):
  permanent `11–18, 21–28, 31–38, 41–48`, primary `51–55, 61–65, 71–75, 81–85`. Every table that
  stores a tooth reference (`patient_diagnoses`, `treatment_plans`, `visit_services`) stores this
  code and nothing else; `tooth_status` stores the permanent code of the chart **position** it
  describes, for the same reason (a stable key regardless of what currently occupies it — see
  Context). Universal notation is derived on the fly (`toUniversal`, `parseTooth`) and never
  stored.
- **Three tenant-level chart settings, all display-only, none of them changes what is stored or
  computed:**
  - `toothNotation` (`fdi` default, or `universal`) — which labels the chart, tooth picker and
    tooth history show. Changing it re-labels every tooth reference in the UI; it never rewrites
    a stored code.
  - `chartOrientation` (`patient_right_on_right` default, as in the POC, or `patient_right_on_left`)
    — which side of the patient renders on the screen's right. It flips the column order, the R/L
    markers, the mesial/distal side of each tooth's surface cells, and the ←/→ keyboard navigation
    order together (`archColumns`, `mesialLeft`, `surfaceCells`, `keyboardOrder`). Mesial is always
    resolved toward the midline from the code's quadrant and position; it is never mirrored
    independently of the orientation setting.
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
