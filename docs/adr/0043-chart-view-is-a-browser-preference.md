# ADR-0043: The chart view is a per-user browser preference; the chart mode stays a tenant setting

- Status: Accepted
- Date: 2026-10-08

## Context

Feature 9 lets the dental chart be read three ways: **Diagnoses** (what is wrong), **Services**
(what was done), or **Both** (services on the teeth, diagnoses as dots beside the number). The
choice has to be kept somewhere.

The chart already has display settings — detail (surface or simple), notation, orientation — and
they are tenant settings (ADR-0021): a clinic agrees once how its charts are drawn, and every
screen, printout and person follows.

The view is a different kind of choice. A dentist planning treatment wants the diagnoses; the
same dentist reviewing a history wants the services; the front desk may never switch at all. It
changes several times an hour, by task and by person, and nothing depends on two people seeing
the same one.

We considered:

- **A tenant setting**, with the others. One person's switch would redraw everyone's chart.
- **A per-user setting on the server.** Correct across devices, but it needs a table, a route and
  a write on every switch, for a preference with no consequence.
- **The URL.** It would make the view part of every link to a chart, and the compact charts
  (record overview, the tooth picker) have no URL of their own.
- **The browser** (`localStorage`).

## Decision

1. **The chart view is kept in the browser**: `localStorage` key `dcm.chartView`, default `both`.
   It is client-only: no column, no route, no permission, nothing in the session.
2. **One store for the whole app** (`useChartView`, a `useSyncExternalStore`). Every chart on
   screen follows a switch at once: the workspace card, the record's Dental chart tab, the
   compact charts and the tooth history's glyph. Another tab follows through the `storage` event.
   A browser that refuses storage keeps the choice for the visit.
3. **The chart mode (surface or simple) stays a tenant setting**, with notation and orientation.
   It decides what a clinic records and how its charts are laid out, not what one person looks at.
4. **The legend's highlight is not kept at all.** It is state of the card that shows it, and it
   ends with a selection, a view switch or `Esc`.

## Consequences

- A user who changes computer starts on **Both** again.
- The compact charts have no switch; they follow the stored view.
- The view never reaches the API, so the chart read is the same for everyone and the derived
  teeth carry both the diagnoses and the services. What a view shows is decided where the tooth is
  drawn (`toToothRender`).
- Moving the chart mode to a user preference is out of scope; it would need this ADR and ADR-0021
  revisited.
